import { definePlugin, type milky, msg, param, type Session, seg } from '@fraqjs/fraq';

import { SchedulerService } from './scheduler';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseModerationTarget(segments: milky.IncomingSegment[]): number | undefined {
  const mention = segments.find((segment) => segment.type === 'mention');
  if (mention) {
    return mention.data.user_id;
  }

  const match = segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.data.text)
    .join(' ')
    .match(/\d+/u);
  return match ? Number(match[0]) : undefined;
}

function parseModerationDuration(segments: milky.IncomingSegment[], targetUserId: number): number | undefined {
  const numbers = segments
    .filter((segment) => segment.type === 'text')
    .flatMap((segment) => segment.data.text.match(/\d+/gu) ?? [])
    .map(Number);
  const firstNonTargetNumber = numbers.find((number) => number !== targetUserId);
  return firstNonTargetNumber && firstNonTargetNumber > 0 ? firstNonTargetNumber : undefined;
}

function canBotModerateTarget(
  botRole: 'owner' | 'admin' | 'member',
  targetRole: 'owner' | 'admin' | 'member',
): boolean {
  if (botRole === 'owner') {
    return targetRole !== 'owner';
  }

  if (botRole === 'admin') {
    return targetRole === 'member';
  }

  return false;
}

function parseTextNumbers(segments: milky.IncomingSegment[]): number[] {
  return segments
    .filter((segment) => segment.type === 'text')
    .flatMap((segment) => segment.data.text.match(/\d+/gu) ?? [])
    .map(Number);
}

function parseRecallTarget(segments: milky.IncomingSegment[]): number | undefined {
  const mention = segments.find((segment) => segment.type === 'mention');
  if (mention) {
    return mention.data.user_id;
  }

  const numbers = parseTextNumbers(segments);
  return numbers.length > 1 ? numbers[0] : undefined;
}

function parseRecallCount(segments: milky.IncomingSegment[]): number | undefined {
  const hasMentionTarget = segments.some((segment) => segment.type === 'mention');
  const numbers = parseTextNumbers(segments);
  const count = hasMentionTarget || numbers.length === 1 ? numbers[0] : numbers[1];
  return count && count > 0 ? count : undefined;
}

function parseReplySegment(
  segments: milky.IncomingSegment[],
): Extract<milky.IncomingSegment, { type: 'reply' }> | undefined {
  return segments.find((segment) => segment.type === 'reply') as
    | Extract<milky.IncomingSegment, { type: 'reply' }>
    | undefined;
}

function uniqueMessages(messages: milky.IncomingMessage[]): milky.IncomingMessage[] {
  const seenMessageSeqs = new Set<number>();
  return messages.filter((message) => {
    if (seenMessageSeqs.has(message.message_seq)) {
      return false;
    }

    seenMessageSeqs.add(message.message_seq);
    return true;
  });
}

function sortMessagesNewestFirst(messages: milky.IncomingMessage[]): milky.IncomingMessage[] {
  return [...messages].sort((a, b) => b.message_seq - a.message_seq);
}

function selectRecallMessages(
  messages: milky.IncomingMessage[],
  anchorMessageSeq: number,
  includeAnchor: boolean,
  targetUserId: number | undefined,
  protectedUserIds?: ReadonlySet<number>,
): milky.IncomingMessage[] {
  return sortMessagesNewestFirst(
    uniqueMessages(messages).filter((message) => {
      if (message.message_scene !== 'group') {
        return false;
      }

      if (includeAnchor ? message.message_seq > anchorMessageSeq : message.message_seq >= anchorMessageSeq) {
        return false;
      }

      if (protectedUserIds?.has(message.sender_id)) {
        return false;
      }

      return targetUserId ? message.sender_id === targetUserId : true;
    }),
  );
}

function addIntegerArrayToSet(value: unknown, target: Set<number>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (Number.isInteger(item)) {
      target.add(item);
    }
  }
}

function addBooleanRecordToMap(value: unknown, target: Map<number, boolean>): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const groupId = Number(key);
    if (Number.isInteger(groupId) && typeof item === 'boolean') {
      target.set(groupId, item);
    }
  }
}

function booleanMapToRecord(value: ReadonlyMap<number, boolean>): Record<string, boolean> {
  return Object.fromEntries([...value.entries()].sort(([left], [right]) => left - right));
}

type GroupAdminCommandKey = 'title' | 'blacklist' | 'whitelist' | 'kick' | 'mute' | 'recall';

const groupAdminCommandDefinitions: {
  key: GroupAdminCommandKey;
  label: string;
  names: readonly string[];
}[] = [
  { key: 'title', label: 'title', names: ['title', '头衔', '专属头衔'] },
  { key: 'blacklist', label: '添加黑名单', names: ['添加黑名单', '黑名单', 'blacklist-add'] },
  { key: 'whitelist', label: '添加白名单', names: ['添加白名单', '白名单', 'whitelist-add'] },
  { key: 'kick', label: '踢人', names: ['踢人', '踢', 'kick'] },
  { key: 'mute', label: '禁言', names: ['禁言', 'mute'] },
  { key: 'recall', label: '撤回', names: ['撤回', 'recall'] },
];

const commandNameMap = new Map(
  groupAdminCommandDefinitions.flatMap(({ key, names }) =>
    names.map((name) => [name.toLocaleLowerCase(), key] as const),
  ),
);

function parseGroupAdminCommandKey(text: string): GroupAdminCommandKey | undefined {
  return commandNameMap.get(text.trim().toLocaleLowerCase());
}

function getGroupAdminCommandLabel(key: GroupAdminCommandKey): string {
  return groupAdminCommandDefinitions.find((definition) => definition.key === key)?.label ?? key;
}

function addCommandSwitchRecordToMap(value: unknown, target: Map<number, Map<GroupAdminCommandKey, boolean>>): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [groupIdText, item] of Object.entries(value)) {
    const groupId = Number(groupIdText);
    if (!Number.isInteger(groupId) || !item || typeof item !== 'object') {
      continue;
    }

    const switches = target.get(groupId) ?? new Map<GroupAdminCommandKey, boolean>();
    for (const [commandKeyText, enabled] of Object.entries(item)) {
      if (
        groupAdminCommandDefinitions.some((definition) => definition.key === commandKeyText) &&
        typeof enabled === 'boolean'
      ) {
        switches.set(commandKeyText as GroupAdminCommandKey, enabled);
      }
    }

    target.set(groupId, switches);
  }
}

function commandSwitchMapToRecord(
  value: ReadonlyMap<number, ReadonlyMap<GroupAdminCommandKey, boolean>>,
): Record<string, Record<GroupAdminCommandKey, boolean>> {
  return Object.fromEntries(
    [...value.entries()]
      .sort(([left], [right]) => left - right)
      .map(([groupId, switches]) => [
        groupId,
        Object.fromEntries([...switches.entries()].sort(([left], [right]) => left.localeCompare(right))) as Record<
          GroupAdminCommandKey,
          boolean
        >,
      ]),
  );
}

export interface GroupAdminPluginOptions {
  commandPrefix?: string;
  minimumAllowedLevel?: number;
  rejectionReason?: string;
  manualRejectionReason?: string;
  reviewerUserIds?: number[];
  moderatorUserIds?: number[];
  inactiveCleanupCron?: string;
  inactiveCleanupFreeSlotsThreshold?: number;
  inactiveCleanupKickLimit?: number;
  spamDetectionWindowMs?: number;
  spamDetectionSegmentLimit?: number;
  spamAction?: 'kick' | 'mute';
  spamMuteDurationSeconds?: number;
  manualMuteDurationSeconds?: number;
  blacklistUserIds?: number[];
  blacklistRejectionReason?: string;
  blacklistCleanupCron?: string;
  whitelistUserIds?: number[];
}

export const GroupAdminPlugin = definePlugin({
  name: 'group-admin',
  inject: {
    scheduler: SchedulerService,
  },
  apply(ctx, options?: GroupAdminPluginOptions) {
    const commandPrefix = options?.commandPrefix ?? '/';
    const withCommandPrefix = (name: string): string => `${commandPrefix}${name}`;
    const prefixedCommandNames = (names: readonly string[]): string[] => names.map(withCommandPrefix);
    const parseConfiguredCommandKey = (text: string): GroupAdminCommandKey | undefined =>
      parseGroupAdminCommandKey(
        commandPrefix && text.startsWith(commandPrefix) ? text.slice(commandPrefix.length) : text,
      );
    const minimumAllowedLevel = options?.minimumAllowedLevel ?? 5;
    const rejectionReason = options?.rejectionReason ?? `QQ 等级低于 ${minimumAllowedLevel}，暂不允许入群`;
    const manualRejectionReason = options?.manualRejectionReason ?? '管理员拒绝入群';
    const reviewerUserIds = new Set(options?.reviewerUserIds ?? []);
    const moderatorUserIds = new Set(options?.moderatorUserIds ?? options?.reviewerUserIds ?? []);
    const inactiveCleanupFreeSlotsThreshold = options?.inactiveCleanupFreeSlotsThreshold ?? 9;
    const inactiveCleanupKickLimit = options?.inactiveCleanupKickLimit ?? 100;
    const spamDetectionWindowMs = options?.spamDetectionWindowMs ?? 10_000;
    const spamDetectionSegmentLimit = options?.spamDetectionSegmentLimit ?? 8;
    const spamAction = options?.spamAction ?? 'mute';
    const spamMuteDurationSeconds = options?.spamMuteDurationSeconds ?? 600;
    const manualMuteDurationSeconds = options?.manualMuteDurationSeconds ?? spamMuteDurationSeconds;
    const blacklistedUserIds = new Set(options?.blacklistUserIds ?? []);
    const blacklistRejectionReason = options?.blacklistRejectionReason ?? '已被加入黑名单';
    const whitelistedUserIds = new Set(options?.whitelistUserIds ?? []);
    const groupSwitches = new Map<number, boolean>();
    const commandSwitches = new Map<number, boolean>();
    const commandFeatureSwitches = new Map<number, Map<GroupAdminCommandKey, boolean>>();
    const silentSwitches = new Map<number, boolean>();
    const listDataPath = './data/data.json';
    const pendingJoinRequests = new Map<
      number,
      {
        groupId: number;
        initiatorId: number;
        notificationSeq: number;
        isFiltered: boolean;
      }
    >();
    const spamRecords = new Map<string, { timestamps: number[]; violationCount: number }>();

    const saveListData = async () => {
      await mkdir(dirname(listDataPath), { recursive: true });
      await writeFile(
        listDataPath,
        `${JSON.stringify(
          {
            blacklistUserIds: [...blacklistedUserIds].sort((a, b) => a - b),
            whitelistUserIds: [...whitelistedUserIds].sort((a, b) => a - b),
            groupSwitches: booleanMapToRecord(groupSwitches),
            commandSwitches: booleanMapToRecord(commandSwitches),
            commandFeatureSwitches: commandSwitchMapToRecord(commandFeatureSwitches),
            silentSwitches: booleanMapToRecord(silentSwitches),
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    };

    const listDataReady = (async () => {
      try {
        const content = await readFile(listDataPath, 'utf8');
        const data: unknown = JSON.parse(content);
        if (!data || typeof data !== 'object') {
          ctx.logger.warn(`名单数据格式无效：${listDataPath}`);
          await saveListData();
          return;
        }

        addIntegerArrayToSet('blacklistUserIds' in data ? data.blacklistUserIds : undefined, blacklistedUserIds);
        addIntegerArrayToSet('whitelistUserIds' in data ? data.whitelistUserIds : undefined, whitelistedUserIds);
        addBooleanRecordToMap('groupSwitches' in data ? data.groupSwitches : undefined, groupSwitches);
        addBooleanRecordToMap('commandSwitches' in data ? data.commandSwitches : undefined, commandSwitches);
        addCommandSwitchRecordToMap(
          'commandFeatureSwitches' in data ? data.commandFeatureSwitches : undefined,
          commandFeatureSwitches,
        );
        addBooleanRecordToMap('silentSwitches' in data ? data.silentSwitches : undefined, silentSwitches);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
          ctx.logger.error(`读取名单数据失败：${listDataPath}`, error);
        }
      }

      await saveListData();
    })();

    const isGroupEnabled = (groupId: number): boolean => groupSwitches.get(groupId) ?? true;
    const areCommandsEnabled = (groupId: number): boolean => commandSwitches.get(groupId) ?? true;
    const isCommandFeatureEnabled = (groupId: number, commandKey: GroupAdminCommandKey): boolean =>
      commandFeatureSwitches.get(groupId)?.get(commandKey) ?? true;
    const isSilentEnabled = (groupId: number): boolean => silentSwitches.get(groupId) ?? false;

    const replyIfNotSilent = async (session: Session, content: Parameters<Session['reply']>[0]) => {
      if (session.raw.message_scene === 'group' && isSilentEnabled(session.raw.peer_id)) {
        return;
      }

      await session.reply(content);
    };

    const sendGroupMessageIfNotSilent = async (
      groupId: number,
      message: Parameters<typeof ctx.client.send_group_message>[0]['message'],
    ) => {
      if (isSilentEnabled(groupId)) {
        return undefined;
      }

      return ctx.client.send_group_message({
        group_id: groupId,
        message,
      });
    };

    const canUseGroupAdminCommand = (session: Session): boolean =>
      session.raw.message_scene === 'group' &&
      (moderatorUserIds.has(session.raw.sender_id) || session.raw.group_member.role !== 'member');

    const setCommandFeatureSwitch = (groupId: number, commandKey: GroupAdminCommandKey, enabled: boolean) => {
      const switches = commandFeatureSwitches.get(groupId) ?? new Map<GroupAdminCommandKey, boolean>();
      switches.set(commandKey, enabled);
      commandFeatureSwitches.set(groupId, switches);
    };

    const formatCommandFeatureSwitchStatus = (groupId: number): string =>
      groupAdminCommandDefinitions
        .map(({ key, label }) => `${label}${isCommandFeatureEnabled(groupId, key) ? '开' : '关'}`)
        .join('，');

    const formatCommandFeatureNames = (): string => groupAdminCommandDefinitions.map(({ label }) => label).join('、');

    const executeCommandFeatureSwitchCommand = async (session: Session, commandName: string, enabled: boolean) => {
      if (!commandName.trim()) {
        await executeSwitchCommand(session, 'command', enabled);
        return;
      }

      const commandKey = parseConfiguredCommandKey(commandName);
      if (!commandKey) {
        await session.reply(msg`未知命令：${commandName}。可设置：${formatCommandFeatureNames()}`);
        return;
      }

      await executeSwitchCommand(session, 'command', enabled, commandKey);
    };

    const ensureCommandAvailable = async (session: Session, commandKey: GroupAdminCommandKey): Promise<boolean> => {
      await listDataReady;

      if (session.raw.message_scene !== 'group') {
        await replyIfNotSilent(session, msg`请在群聊中使用群管理命令`);
        return false;
      }

      if (!isGroupEnabled(session.raw.peer_id)) {
        await replyIfNotSilent(session, msg`本群群管已关闭`);
        return false;
      }

      if (!areCommandsEnabled(session.raw.peer_id)) {
        await replyIfNotSilent(session, msg`本群群管命令已关闭`);
        return false;
      }

      if (!isCommandFeatureEnabled(session.raw.peer_id, commandKey)) {
        await replyIfNotSilent(session, msg`本群 ${getGroupAdminCommandLabel(commandKey)} 命令已关闭`);
        return false;
      }

      if (!canUseGroupAdminCommand(session)) {
        await replyIfNotSilent(session, msg`你没有权限使用群管理命令`);
        return false;
      }

      return true;
    };

    const executeSwitchCommand = async (
      session: Session,
      target: 'group' | 'command' | 'silent' | 'all',
      enabled: boolean,
      commandKey?: GroupAdminCommandKey,
    ) => {
      await listDataReady;

      if (session.raw.message_scene !== 'group') {
        await session.reply(msg`请在群聊中使用群管开关命令`);
        return;
      }

      if (!canUseGroupAdminCommand(session)) {
        await session.reply(msg`你没有权限使用群管理命令`);
        return;
      }

      if (target === 'group' || target === 'all') {
        groupSwitches.set(session.raw.peer_id, enabled);
      }

      if (target === 'command' && commandKey) {
        setCommandFeatureSwitch(session.raw.peer_id, commandKey, enabled);
      } else if (target === 'command' || target === 'all') {
        commandSwitches.set(session.raw.peer_id, enabled);
      }

      if (target === 'silent') {
        silentSwitches.set(session.raw.peer_id, enabled);
      }

      await saveListData();
      await session.reply(
        msg`已${enabled ? '开启' : '关闭'}${
          target === 'command' && commandKey
            ? `${getGroupAdminCommandLabel(commandKey)} 命令`
            : target === 'group'
              ? '群管'
              : target === 'command'
                ? '群管命令'
                : target === 'silent'
                  ? '静默模式'
                  : '群管和命令'
        }`,
      );
    };

    const kickBlacklistedMember = async (
      groupId: number,
      userId: number,
      selfId: number,
      source: string,
    ): Promise<boolean> => {
      await listDataReady;

      if (userId === selfId || whitelistedUserIds.has(userId)) {
        return false;
      }

      try {
        const [{ member }, { member: botMember }] = await Promise.all([
          ctx.client.get_group_member_info({
            group_id: groupId,
            user_id: userId,
            no_cache: true,
          }),
          ctx.client.get_group_member_info({
            group_id: groupId,
            user_id: selfId,
            no_cache: true,
          }),
        ]);
        if (!canBotModerateTarget(botMember.role, member.role)) {
          ctx.logger.warn(`黑名单踢出跳过：机器人权限不足，来源 ${source}，群 ${groupId}，用户 ${userId}`);
          return false;
        }

        await ctx.client.kick_group_member({
          group_id: groupId,
          user_id: userId,
          reject_add_request: false,
        });
        ctx.logger.info(`已踢出黑名单成员：来源 ${source}，群 ${groupId}，用户 ${userId}`);
        return true;
      } catch (error) {
        ctx.logger.error(`黑名单踢出失败：来源 ${source}，群 ${groupId}，用户 ${userId}`, error);
        return false;
      }
    };

    const getRecallCandidates = async (
      groupId: number,
      anchorMessageSeq: number,
      includeAnchor: boolean,
      targetUserId: number | undefined,
      count: number,
    ): Promise<milky.IncomingMessage[]> => {
      const candidates: milky.IncomingMessage[] = [];
      let cursor: number | undefined = anchorMessageSeq;

      if (includeAnchor) {
        try {
          const { message } = await ctx.client.get_message({
            message_scene: 'group',
            peer_id: groupId,
            message_seq: anchorMessageSeq,
          });
          candidates.push(...selectRecallMessages([message], anchorMessageSeq, true, targetUserId, whitelistedUserIds));
        } catch (error) {
          ctx.logger.warn(`获取撤回锚点消息失败：群 ${groupId}，消息 ${anchorMessageSeq}`, error);
        }
      }

      while (cursor && uniqueMessages(candidates).length < count) {
        const { messages, next_message_seq } = await ctx.client.get_history_messages({
          message_scene: 'group',
          peer_id: groupId,
          start_message_seq: cursor,
          limit: 30,
        });

        candidates.push(
          ...selectRecallMessages(messages, anchorMessageSeq, includeAnchor, targetUserId, whitelistedUserIds),
        );
        if (!next_message_seq || next_message_seq === cursor) {
          break;
        }

        cursor = next_message_seq;
      }

      return sortMessagesNewestFirst(uniqueMessages(candidates)).slice(0, count);
    };

    const recallGroupMessages = async (
      groupId: number,
      messageSeqs: number[],
    ): Promise<{ success: number; failed: number }> => {
      let success = 0;
      let failed = 0;

      for (const messageSeq of messageSeqs) {
        try {
          await ctx.client.recall_group_message({
            group_id: groupId,
            message_seq: messageSeq,
          });
          success += 1;
        } catch (error) {
          failed += 1;
          ctx.logger.warn(`撤回群消息失败：群 ${groupId}，消息 ${messageSeq}`, error);
        }
      }

      return { success, failed };
    };

    const executeRecallCommand = async (session: Session, segments: milky.IncomingSegment[]) => {
      await listDataReady;

      if (session.raw.message_scene !== 'group') {
        await replyIfNotSilent(session, msg`请在群聊中使用撤回命令`);
        return;
      }

      if (!isGroupEnabled(session.raw.peer_id)) {
        await replyIfNotSilent(session, msg`本群群管已关闭`);
        return;
      }

      if (!areCommandsEnabled(session.raw.peer_id)) {
        await replyIfNotSilent(session, msg`本群群管命令已关闭`);
        return;
      }

      if (!isCommandFeatureEnabled(session.raw.peer_id, 'recall')) {
        await replyIfNotSilent(session, msg`本群 ${getGroupAdminCommandLabel('recall')} 命令已关闭`);
        return;
      }

      if (!moderatorUserIds.has(session.raw.sender_id) && session.raw.group_member.role === 'member') {
        await replyIfNotSilent(session, msg`你没有权限使用群管理命令`);
        return;
      }

      const { member: botMember } = await ctx.client.get_group_member_info({
        group_id: session.raw.peer_id,
        user_id: session.selfId,
        no_cache: true,
      });
      if (botMember.role === 'member') {
        await replyIfNotSilent(session, msg`机器人不是群主或管理员，无法撤回群消息`);
        return;
      }

      const reply = parseReplySegment(segments);
      const targetUserId = parseRecallTarget(segments);
      const count = parseRecallCount(segments);

      if (!reply && !count) {
        await replyIfNotSilent(session, msg`请提供撤回数量，或回复一条消息后使用撤回`);
        return;
      }

      if (reply && !count && whitelistedUserIds.has(reply.data.sender_id)) {
        await replyIfNotSilent(session, msg`被回复的消息来自白名单用户，不能撤回`);
        return;
      }

      const messageSeqs = count
        ? (
            await getRecallCandidates(
              session.raw.peer_id,
              reply?.data.message_seq ?? session.raw.message_seq,
              Boolean(reply),
              targetUserId,
              count,
            )
          ).map((message) => message.message_seq)
        : [reply?.data.message_seq].filter((messageSeq): messageSeq is number => messageSeq !== undefined);

      if (messageSeqs.length === 0) {
        await replyIfNotSilent(session, msg`没有找到可撤回的消息`);
        return;
      }

      const { success, failed } = await recallGroupMessages(session.raw.peer_id, messageSeqs);
      await replyIfNotSilent(
        session,
        failed ? msg`已撤回 ${success} 条消息，${failed} 条失败` : msg`已撤回 ${success} 条消息`,
      );
    };

    ctx.logger.info(`已载入插件：group-admin，入群最低 QQ 等级：${minimumAllowedLevel}`);
    ctx.scheduler.expression(options?.inactiveCleanupCron ?? '0 4 * * *', async () => {
      try {
        await listDataReady;

        const { groups } = await ctx.client.get_group_list();

        for (const group of groups) {
          if (!isGroupEnabled(group.group_id)) {
            continue;
          }

          const freeSlots = group.max_member_count - group.member_count;
          if (freeSlots > inactiveCleanupFreeSlotsThreshold) {
            continue;
          }

          const { members } = await ctx.client.get_group_member_list({
            group_id: group.group_id,
            no_cache: true,
          });
          const targets = members
            .filter((member) => member.role === 'member' && !whitelistedUserIds.has(member.user_id))
            .sort((a, b) => a.last_sent_time - b.last_sent_time)
            .slice(0, inactiveCleanupKickLimit);

          let kickedCount = 0;
          for (const target of targets) {
            try {
              await ctx.client.kick_group_member({
                group_id: group.group_id,
                user_id: target.user_id,
                reject_add_request: false,
              });
              kickedCount += 1;
            } catch (error) {
              ctx.logger.error(`踢出长期未发言群员失败：群 ${group.group_id}，用户 ${target.user_id}`, error);
            }
          }

          ctx.logger.info(
            `群员清理完成：群 ${group.group_id}，剩余名额 ${freeSlots}，计划踢出 ${targets.length} 人，实际踢出 ${kickedCount} 人`,
          );
        }
      } catch (error) {
        ctx.logger.error('每日群员清理失败', error);
      }
    });

    ctx.scheduler.expression(options?.blacklistCleanupCron ?? '0 3 * * *', async () => {
      try {
        await listDataReady;

        if (blacklistedUserIds.size === 0) {
          return;
        }

        const { uin } = await ctx.client.get_login_info();
        const { groups } = await ctx.client.get_group_list();

        for (const group of groups) {
          if (!isGroupEnabled(group.group_id)) {
            continue;
          }

          const { members } = await ctx.client.get_group_member_list({
            group_id: group.group_id,
            no_cache: true,
          });

          for (const member of members) {
            if (blacklistedUserIds.has(member.user_id) && !whitelistedUserIds.has(member.user_id)) {
              await kickBlacklistedMember(group.group_id, member.user_id, uin, 'daily');
            }
          }
        }
      } catch (error) {
        ctx.logger.error('每日黑名单清理失败', error);
      }
    });

    ctx.router
      .command(withCommandPrefix('help'))
      .alias(...prefixedCommandNames(['帮助', '菜单']))
      .execute(async (session) => {
        await listDataReady;

        const switchStatus =
          session.raw.message_scene === 'group'
            ? `\n当前群状态：群管${isGroupEnabled(session.raw.peer_id) ? '开启' : '关闭'}，命令${
                areCommandsEnabled(session.raw.peer_id) ? '开启' : '关闭'
              }，静默${isSilentEnabled(session.raw.peer_id) ? '开启' : '关闭'}\n命令状态：${formatCommandFeatureSwitchStatus(
                session.raw.peer_id,
              )}`
            : '';

        await session.reply(msg`群管帮助${switchStatus}

开关：
${withCommandPrefix('群开')}/${withCommandPrefix('群关')}：开启或关闭自动群管
${withCommandPrefix('命令开')}/${withCommandPrefix('命令关')}：开启或关闭全部群管命令
${withCommandPrefix('命令开')} 名称/${withCommandPrefix('命令关')} 名称：开启或关闭单个命令
${withCommandPrefix('静默开')}/${withCommandPrefix('静默关')}：开启或关闭静默模式
${withCommandPrefix('一键开')}/${withCommandPrefix('一键关')}：同时开关群管和命令

常用：
${withCommandPrefix('title')} 头衔：设置专属头衔
${withCommandPrefix('添加黑名单')} @成员/QQ号
${withCommandPrefix('添加白名单')} @成员/QQ号
${withCommandPrefix('踢人')} @成员/QQ号
${withCommandPrefix('禁言')} @成员/QQ号 [秒数]
${withCommandPrefix('撤回')} 数量
${withCommandPrefix('撤回')} @成员/QQ号 数量
回复消息后发送 ${withCommandPrefix('撤回')} 或 ${withCommandPrefix('撤回')} 数量

入群审核：
回复审核通知 ${withCommandPrefix('y')} 通过
回复审核通知 ${withCommandPrefix('n')} 拒绝

英文别名：
${withCommandPrefix('kick')}、${withCommandPrefix('mute')}、${withCommandPrefix('recall')}、${withCommandPrefix('blacklist-add')}、${withCommandPrefix('whitelist-add')}`);
      });

    ctx.router
      .command(withCommandPrefix('群开'))
      .alias(withCommandPrefix('群管开'))
      .execute(async (session) => {
        await executeSwitchCommand(session, 'group', true);
      });

    ctx.router
      .command(withCommandPrefix('群关'))
      .alias(withCommandPrefix('群管关'))
      .execute(async (session) => {
        await executeSwitchCommand(session, 'group', false);
      });

    ctx.router
      .command(withCommandPrefix('命令开'))
      .arg('commandName', param.greedy())
      .execute(async (session, { commandName }) => {
        await executeCommandFeatureSwitchCommand(session, commandName, true);
      });

    ctx.router.command(withCommandPrefix('命令开')).execute(async (session) => {
      await executeSwitchCommand(session, 'command', true);
    });

    ctx.router
      .command(withCommandPrefix('命令关'))
      .arg('commandName', param.greedy())
      .execute(async (session, { commandName }) => {
        await executeCommandFeatureSwitchCommand(session, commandName, false);
      });

    ctx.router.command(withCommandPrefix('命令关')).execute(async (session) => {
      await executeSwitchCommand(session, 'command', false);
    });

    ctx.router.command(withCommandPrefix('静默开')).execute(async (session) => {
      await executeSwitchCommand(session, 'silent', true);
    });

    ctx.router.command(withCommandPrefix('静默关')).execute(async (session) => {
      await executeSwitchCommand(session, 'silent', false);
    });

    ctx.router.command(withCommandPrefix('一键开')).execute(async (session) => {
      await executeSwitchCommand(session, 'all', true);
    });

    ctx.router.command(withCommandPrefix('一键关')).execute(async (session) => {
      await executeSwitchCommand(session, 'all', false);
    });

    ctx.router
      .command(withCommandPrefix('title'))
      .arg('title', param.greedy())
      .execute(async (session, { title }) => {
        await listDataReady;

        if (session.raw.message_scene !== 'group') {
          await replyIfNotSilent(session, msg`请在群聊中使用 title 指令`);
          return;
        }

        if (!isGroupEnabled(session.raw.peer_id)) {
          await replyIfNotSilent(session, msg`本群群管已关闭`);
          return;
        }

        if (!areCommandsEnabled(session.raw.peer_id)) {
          await replyIfNotSilent(session, msg`本群群管命令已关闭`);
          return;
        }

        if (!isCommandFeatureEnabled(session.raw.peer_id, 'title')) {
          await replyIfNotSilent(session, msg`本群 ${getGroupAdminCommandLabel('title')} 命令已关闭`);
          return;
        }

        if (new TextEncoder().encode(title).length > 18) {
          await replyIfNotSilent(session, msg`专属头衔不能超过 18 字节`);
          return;
        }

        await ctx.client.set_group_member_special_title({
          group_id: session.raw.peer_id,
          user_id: session.raw.sender_id,
          special_title: title,
        });
      });

    ctx.router
      .command(withCommandPrefix('添加黑名单'))
      .alias(withCommandPrefix('blacklist-add'))
      .arg('target', param.catchAll())
      .execute(async (session, { target }) => {
        if (!(await ensureCommandAvailable(session, 'blacklist'))) {
          return;
        }

        const targetUserId = parseModerationTarget(target);
        if (!targetUserId) {
          await replyIfNotSilent(session, msg`请提供要加入黑名单的账号：添加黑名单 @成员 或 添加黑名单 QQ号`);
          return;
        }

        if (targetUserId === session.selfId) {
          await replyIfNotSilent(session, msg`不能把机器人加入黑名单`);
          return;
        }

        blacklistedUserIds.add(targetUserId);
        await saveListData();
        await replyIfNotSilent(session, msg`已将 ${targetUserId} 加入黑名单`);
      });

    ctx.router
      .command(withCommandPrefix('添加白名单'))
      .alias(withCommandPrefix('whitelist-add'))
      .arg('target', param.catchAll())
      .execute(async (session, { target }) => {
        if (!(await ensureCommandAvailable(session, 'whitelist'))) {
          return;
        }

        const targetUserId = parseModerationTarget(target);
        if (!targetUserId) {
          await replyIfNotSilent(session, msg`请提供要加入白名单的账号：添加白名单 @成员 或 添加白名单 QQ号`);
          return;
        }

        whitelistedUserIds.add(targetUserId);
        await saveListData();
        await replyIfNotSilent(session, msg`已将 ${targetUserId} 加入白名单`);
      });

    ctx.router
      .command(withCommandPrefix('踢人'))
      .alias(...prefixedCommandNames(['kick', '踢']))
      .arg('target', param.catchAll())
      .execute(async (session, { target }) => {
        if (!(await ensureCommandAvailable(session, 'kick'))) {
          return;
        }

        const targetUserId = parseModerationTarget(target);
        if (!targetUserId) {
          await replyIfNotSilent(session, msg`请提供要踢出的成员：踢人 @成员 或 踢人 QQ号`);
          return;
        }

        if (targetUserId === session.selfId) {
          await replyIfNotSilent(session, msg`不能操作机器人账号`);
          return;
        }

        if (whitelistedUserIds.has(targetUserId)) {
          await replyIfNotSilent(session, msg`该成员在白名单中，不能踢出`);
          return;
        }

        const [{ member }, { member: botMember }] = await Promise.all([
          ctx.client.get_group_member_info({
            group_id: session.raw.peer_id,
            user_id: targetUserId,
            no_cache: true,
          }),
          ctx.client.get_group_member_info({
            group_id: session.raw.peer_id,
            user_id: session.selfId,
            no_cache: true,
          }),
        ]);
        if (!canBotModerateTarget(botMember.role, member.role)) {
          await replyIfNotSilent(session, msg`机器人权限不足，无法踢出该成员`);
          return;
        }

        await ctx.client.kick_group_member({
          group_id: session.raw.peer_id,
          user_id: targetUserId,
          reject_add_request: false,
        });
        await replyIfNotSilent(session, msg`已踢出成员 ${targetUserId}`);
      });

    ctx.router
      .command(withCommandPrefix('禁言'))
      .alias(withCommandPrefix('mute'))
      .arg('target', param.catchAll())
      .execute(async (session, { target }) => {
        if (!(await ensureCommandAvailable(session, 'mute'))) {
          return;
        }

        const targetUserId = parseModerationTarget(target);
        if (!targetUserId) {
          await replyIfNotSilent(session, msg`请提供要禁言的成员：禁言 @成员 [秒数] 或 禁言 QQ号 [秒数]`);
          return;
        }

        if (targetUserId === session.selfId) {
          await replyIfNotSilent(session, msg`不能操作机器人账号`);
          return;
        }

        if (whitelistedUserIds.has(targetUserId)) {
          await replyIfNotSilent(session, msg`该成员在白名单中，不能禁言`);
          return;
        }

        const [{ member }, { member: botMember }] = await Promise.all([
          ctx.client.get_group_member_info({
            group_id: session.raw.peer_id,
            user_id: targetUserId,
            no_cache: true,
          }),
          ctx.client.get_group_member_info({
            group_id: session.raw.peer_id,
            user_id: session.selfId,
            no_cache: true,
          }),
        ]);
        if (!canBotModerateTarget(botMember.role, member.role)) {
          await replyIfNotSilent(session, msg`机器人权限不足，无法禁言该成员`);
          return;
        }

        const duration = parseModerationDuration(target, targetUserId) ?? manualMuteDurationSeconds;
        await ctx.client.set_group_member_mute({
          group_id: session.raw.peer_id,
          user_id: targetUserId,
          duration,
        });
        await replyIfNotSilent(session, msg`已禁言成员 ${targetUserId} ${duration} 秒`);
      });

    ctx.router
      .command(withCommandPrefix('撤回'))
      .alias(withCommandPrefix('recall'))
      .arg('target', param.catchAll())
      .execute(async (session, { target }) => {
        await executeRecallCommand(session, target);
      });

    ctx.router
      .rawPattern()
      .arg('command', param.union(withCommandPrefix('撤回'), withCommandPrefix('recall')))
      .execute(async (session) => {
        await executeRecallCommand(session, []);
      });

    ctx.router
      .rawPattern()
      .arg('reply', param.segment('reply'))
      .arg('command', param.union(withCommandPrefix('撤回'), withCommandPrefix('recall')))
      .arg('target', param.catchAll())
      .execute(async (session, { reply, target }) => {
        await executeRecallCommand(session, [reply, ...target]);
      });

    ctx.router
      .rawPattern()
      .arg('reply', param.segment('reply'))
      .arg('command', param.union(withCommandPrefix('撤回'), withCommandPrefix('recall')))
      .execute(async (session, { reply }) => {
        await executeRecallCommand(session, [reply]);
      });

    ctx.router
      .rawPattern()
      .arg('reply', param.segment('reply'))
      .arg('decision', param.union(withCommandPrefix('y'), withCommandPrefix('n')))
      .execute(async (session, { reply, decision }) => {
        await listDataReady;

        if (session.raw.message_scene !== 'group') {
          return;
        }

        if (!isGroupEnabled(session.raw.peer_id) || !areCommandsEnabled(session.raw.peer_id)) {
          return;
        }

        const request = pendingJoinRequests.get(reply.data.message_seq);
        if (!request || request.groupId !== session.raw.peer_id) {
          return;
        }

        if (!reviewerUserIds.has(session.raw.sender_id) && session.raw.group_member.role === 'member') {
          await replyIfNotSilent(session, msg`你没有权限处理入群申请`);
          return;
        }

        pendingJoinRequests.delete(reply.data.message_seq);

        if (decision === withCommandPrefix('y')) {
          await ctx.client.accept_group_request({
            group_id: request.groupId,
            notification_seq: request.notificationSeq,
            notification_type: 'join_request',
            is_filtered: request.isFiltered,
          });
          await replyIfNotSilent(session, msg`已同意 ${request.initiatorId} 的入群申请`);
          return;
        }

        await ctx.client.reject_group_request({
          group_id: request.groupId,
          notification_seq: request.notificationSeq,
          notification_type: 'join_request',
          is_filtered: request.isFiltered,
          reason: manualRejectionReason,
        });
        await replyIfNotSilent(session, msg`已拒绝 ${request.initiatorId} 的入群申请`);
      });

    ctx.on('message_receive', async ({ self_id, data }) => {
      try {
        await listDataReady;

        if (data.message_scene !== 'group' || data.sender_id === self_id) {
          return;
        }

        if (!isGroupEnabled(data.peer_id)) {
          return;
        }

        if (whitelistedUserIds.has(data.sender_id)) {
          return;
        }

        if (blacklistedUserIds.has(data.sender_id)) {
          await kickBlacklistedMember(data.peer_id, data.sender_id, self_id, 'message');
          return;
        }

        if (data.group_member.role !== 'member') {
          return;
        }

        const key = `${data.peer_id}:${data.sender_id}`;
        const now = Date.now();
        const record = spamRecords.get(key) ?? {
          timestamps: [],
          violationCount: 0,
        };

        record.timestamps = record.timestamps.filter((time) => now - time <= spamDetectionWindowMs);
        for (let index = 0; index < Math.max(1, data.segments.length); index += 1) {
          record.timestamps.push(now);
        }

        if (record.timestamps.length < spamDetectionSegmentLimit) {
          spamRecords.set(key, record);
          return;
        }

        record.timestamps = [];
        record.violationCount += 1;

        if (record.violationCount <= 2) {
          spamRecords.set(key, record);
          await sendGroupMessageIfNotSilent(
            data.peer_id,
            msg`${seg.mention(data.sender_id)} 请勿刷屏，警告 ${record.violationCount}/2`,
          );
          return;
        }

        spamRecords.delete(key);
        if (spamAction === 'kick') {
          await ctx.client.kick_group_member({
            group_id: data.peer_id,
            user_id: data.sender_id,
            reject_add_request: false,
          });
          await sendGroupMessageIfNotSilent(data.peer_id, msg`已踢出刷屏成员 ${data.sender_id}`);
          return;
        }

        await ctx.client.set_group_member_mute({
          group_id: data.peer_id,
          user_id: data.sender_id,
          duration: spamMuteDurationSeconds,
        });
        await sendGroupMessageIfNotSilent(
          data.peer_id,
          msg`已禁言刷屏成员 ${data.sender_id} ${spamMuteDurationSeconds} 秒`,
        );
      } catch (error) {
        ctx.logger.error(`刷屏检测处理失败：群 ${data.peer_id}，用户 ${data.sender_id}`, error);
      }
    });

    ctx.on('group_member_increase', async ({ self_id, data }) => {
      await listDataReady;

      if (!isGroupEnabled(data.group_id)) {
        return;
      }

      if (!blacklistedUserIds.has(data.user_id) || whitelistedUserIds.has(data.user_id)) {
        return;
      }

      await kickBlacklistedMember(data.group_id, data.user_id, self_id, 'join');
    });

    ctx.on('group_member_decrease', async ({ data }) => {
      try {
        await listDataReady;

        if (!isGroupEnabled(data.group_id)) {
          return;
        }

        await sendGroupMessageIfNotSilent(
          data.group_id,
          data.operator_id
            ? msg`成员 ${data.user_id} 已被 ${data.operator_id} 移出本群`
            : msg`成员 ${data.user_id} 已退出本群`,
        );
      } catch (error) {
        ctx.logger.error(`退群通知发送失败：群 ${data.group_id}，用户 ${data.user_id}`, error);
      }
    });

    ctx.on('group_join_request', async ({ data }) => {
      const { group_id, initiator_id, notification_seq, is_filtered, comment } = data;

      try {
        await listDataReady;

        if (!isGroupEnabled(group_id)) {
          return;
        }

        if (whitelistedUserIds.has(initiator_id)) {
          await ctx.client.accept_group_request({
            group_id,
            notification_seq,
            notification_type: 'join_request',
            is_filtered,
          });

          ctx.logger.info(`已自动同意白名单入群请求：群 ${group_id}，用户 ${initiator_id}`);
          return;
        }

        if (blacklistedUserIds.has(initiator_id)) {
          await ctx.client.reject_group_request({
            group_id,
            notification_seq,
            notification_type: 'join_request',
            is_filtered,
            reason: blacklistRejectionReason,
          });

          ctx.logger.info(`已拒绝黑名单入群请求：群 ${group_id}，用户 ${initiator_id}`);
          return;
        }

        const profile = await ctx.client.get_user_profile({
          user_id: initiator_id,
        });

        if (profile.level >= minimumAllowedLevel) {
          const notification = await sendGroupMessageIfNotSilent(
            group_id,
            msg`收到入群申请
账号：${initiator_id}
昵称：${profile.nickname}
QQ 等级：${profile.level}
申请信息：${comment || '无'}

回复本消息 y 同意，回复 n 拒绝。`,
          );

          if (!notification) {
            ctx.logger.info(
              `静默模式已跳过入群审核通知：群 ${group_id}，用户 ${initiator_id}，QQ 等级 ${profile.level}`,
            );
            return;
          }

          pendingJoinRequests.set(notification.message_seq, {
            groupId: group_id,
            initiatorId: initiator_id,
            notificationSeq: notification_seq,
            isFiltered: is_filtered,
          });

          ctx.logger.info(
            `已发送入群审核通知：群 ${group_id}，用户 ${initiator_id}，QQ 等级 ${profile.level}，通知消息 ${notification.message_seq}`,
          );
          return;
        }

        await ctx.client.reject_group_request({
          group_id,
          notification_seq,
          notification_type: 'join_request',
          is_filtered,
          reason: rejectionReason,
        });

        ctx.logger.info(`已自动拒绝入群请求：群 ${group_id}，用户 ${initiator_id}，QQ 等级 ${profile.level}`);
      } catch (error) {
        ctx.logger.error(`处理入群请求失败：群 ${group_id}，用户 ${initiator_id}`, error);
      }
    });
  },
});

export default GroupAdminPlugin;
