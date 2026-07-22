import { type milky, msg, param, type Session, seg } from '@fraqjs/fraq';

import {
  registerLiteralRawRoutes,
  registerReplyLiteralCatchAllRawRoutes,
  registerReplyLiteralRawRoutes,
} from './activation-routes';
import type { GroupAdminApi, GroupMessage, SentGroupMessage } from './api';
import {
  type GroupAdminCommandKey,
  getGroupAdminCommandLabel,
  groupAdminCommandDefinitions,
  parseGroupAdminCommandKey,
} from './command-definitions';
import {
  canBotModerateTarget,
  parseModerationDuration,
  parseModerationTarget,
  parseRecallCount,
  parseRecallTarget,
  parseReplySegment,
  selectRecallMessages,
  sortMessagesNewestFirst,
  uniqueMessages,
} from './data-processing';
import { classifyRootGroupFiles } from './group-file-classification';
import { buildHelpMessageSections } from './help-message';
import type { JoinReviewCommands } from './join-review';
import { checkGroupMemberCards, type GroupMemberCardManagementOptions } from './member-card-management';
import type { GroupAdminRuntime } from './models';

export interface GroupAdminCommandServices {
  isSilentEnabled: (groupId: number) => boolean;
  replyIfNotSilent: (session: Session, content: Parameters<Session['reply']>[0]) => Promise<void>;
  sendGroupMessageIfNotSilent: (groupId: number, message: GroupMessage) => Promise<SentGroupMessage | undefined>;
  kickBlacklistedMember: (groupId: number, userId: number, selfId: number, source: string) => Promise<boolean>;
}

export function registerGroupAdminCommands(
  runtime: GroupAdminRuntime,
  api: GroupAdminApi,
  groupMemberCardManagement: GroupMemberCardManagementOptions,
): GroupAdminCommandServices {
  const {
    ctx,
    config,
    store: dataStore,
    isGroupInScope,
    isGroupEnabled,
    areCommandsEnabled,
    isCommandFeatureEnabled,
  } = runtime;
  const moderatorUserIds = new Set(config.moderatorUserIds);
  const manualMuteDurationSeconds = config.manualMuteDurationSeconds;
  const router = ctx.router.filter(
    (session) => session.raw.message_scene !== 'group' || isGroupInScope(session.raw.peer_id),
  );
  const {
    blacklistedUserIds,
    whitelistedUserIds,
    forbiddenWords,
    groupSwitches,
    commandSwitches,
    commandFeatureSwitches,
    silentSwitches,
    memberCardSnapshots,
    ready: listDataReady,
    save: saveListData,
  } = dataStore;
  const isSilentEnabled = (groupId: number): boolean => silentSwitches.get(groupId) ?? false;

  const replyIfNotSilent = async (session: Session, content: Parameters<Session['reply']>[0]) => {
    if (session.raw.message_scene === 'group' && isSilentEnabled(session.raw.peer_id)) {
      return;
    }

    await session.reply(content);
  };

  const sendGroupMessageIfNotSilent = async (groupId: number, message: GroupMessage) => {
    if (isSilentEnabled(groupId)) {
      return undefined;
    }

    return api.send_group_message({
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

  const formatCommandFeatureNames = (): string => groupAdminCommandDefinitions.map(({ label }) => label).join('、');

  const executeCommandFeatureSwitchCommand = async (session: Session, commandName: string, enabled: boolean) => {
    if (!commandName.trim()) {
      await executeSwitchCommand(session, 'command', enabled);
      return;
    }

    const commandKey = parseGroupAdminCommandKey(commandName);
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

    if (!isGroupInScope(session.raw.peer_id)) {
      await session.reply(msg`本群不在 group-admin 的 groupIds 作用域内`);
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
        api.get_group_member_info({
          group_id: groupId,
          user_id: userId,
          no_cache: true,
        }),
        api.get_group_member_info({
          group_id: groupId,
          user_id: selfId,
          no_cache: true,
        }),
      ]);
      if (!canBotModerateTarget(botMember.role, member.role)) {
        ctx.logger.warn(`黑名单踢出跳过：机器人权限不足，来源 ${source}，群 ${groupId}，用户 ${userId}`);
        return false;
      }

      await api.kick_group_member({
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
        const { message } = await api.get_message({
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
      const { messages, next_message_seq } = await api.get_history_messages({
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
        await api.recall_group_message({
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

    const { member: botMember } = await api.get_group_member_info({
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

  const executeGroupFileClassificationCommand = async (session: Session) => {
    if (!(await ensureCommandAvailable(session, 'fileClassification'))) {
      return;
    }

    const { member: botMember } = await api.get_group_member_info({
      group_id: session.raw.peer_id,
      user_id: session.selfId,
      no_cache: true,
    });
    if (botMember.role === 'member') {
      await replyIfNotSilent(session, msg`机器人不是群主或管理员，无法移动群文件`);
      return;
    }

    const { moved, skipped, failed } = await classifyRootGroupFiles({
      ctx: { logger: ctx.logger, api },
      groupId: session.raw.peer_id,
      mode: config.groupFileClassificationMode,
      categories: config.groupFileClassificationCategories,
      fallbackFolderName: config.groupFileClassificationFallbackFolderName,
    });
    await replyIfNotSilent(session, msg`群文件分类完成：移动 ${moved} 个，跳过 ${skipped} 个，失败 ${failed} 个`);
  };

  const executeGroupMemberCardCheckCommand = async (session: Session) => {
    if (!(await ensureCommandAvailable(session, 'memberCard'))) {
      return;
    }

    const result = await checkGroupMemberCards({
      ctx: { logger: ctx.logger, api },
      groupId: session.raw.peer_id,
      botUserId: session.selfId,
      cardSnapshots: memberCardSnapshots,
      management: groupMemberCardManagement,
      notify: (message) => sendGroupMessageIfNotSilent(session.raw.peer_id, message).then(() => undefined),
    });
    await saveListData();
    await replyIfNotSilent(
      session,
      msg`群名片检查完成：检查 ${result.checked} 人，改动 ${result.changed} 人，违规 ${result.invalid} 人，恢复 ${result.reset} 人，失败 ${result.failed} 人`,
    );
  };

  router
    .command('help')
    .alias('帮助', '菜单')
    .tag('group-admin:help')
    .execute(async (session) => {
      await listDataReady;

      const helpSections = buildHelpMessageSections({
        groupId: session.raw.message_scene === 'group' ? session.raw.peer_id : undefined,
        isGroupEnabled,
        areCommandsEnabled,
        isSilentEnabled,
        isCommandFeatureEnabled,
      });

      await session.reply([
        seg.forward(
          helpSections.map(({ title, content }) => ({
            user_id: session.selfId,
            sender_name: title,
            segments: msg`${content}`,
          })),
          {
            title: '群管帮助',
            preview: helpSections.slice(0, 4).map(({ title }) => title),
            summary: `共 ${helpSections.length} 段群管帮助`,
            prompt: '群管帮助',
          },
        ),
      ]);
    });

  router
    .command('群开')
    .alias('群管开')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'group', true);
    });

  router
    .command('群关')
    .alias('群管关')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'group', false);
    });

  router
    .command('命令开')
    .arg('commandName', param.greedy())
    .tag('group-admin:control')
    .execute(async (session, { commandName }) => {
      await executeCommandFeatureSwitchCommand(session, commandName, true);
    });

  router
    .command('命令开')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'command', true);
    });

  router
    .command('命令关')
    .arg('commandName', param.greedy())
    .tag('group-admin:control')
    .execute(async (session, { commandName }) => {
      await executeCommandFeatureSwitchCommand(session, commandName, false);
    });

  router
    .command('命令关')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'command', false);
    });

  router
    .command('静默开')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'silent', true);
    });

  router
    .command('静默关')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'silent', false);
    });

  router
    .command('一键开')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'all', true);
    });

  router
    .command('一键关')
    .tag('group-admin:control')
    .execute(async (session) => {
      await executeSwitchCommand(session, 'all', false);
    });

  router
    .command('文件分类')
    .alias('群文件分类', 'file-classify')
    .tag('group-admin:file-classification')
    .execute(async (session) => {
      await executeGroupFileClassificationCommand(session);
    });

  router
    .command('名片检查')
    .alias('群名片检查', 'card-check')
    .tag('group-admin:member-card')
    .execute(async (session) => {
      await executeGroupMemberCardCheckCommand(session);
    });

  router
    .command('添加黑名单')
    .alias('blacklist-add')
    .arg('target', param.catchAll())
    .tag('group-admin:blacklist')
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

  router
    .command('添加白名单')
    .alias('whitelist-add')
    .arg('target', param.catchAll())
    .tag('group-admin:whitelist')
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

  router
    .command('添加违禁词')
    .alias('word-add')
    .arg('word', param.greedy())
    .tag('group-admin:forbidden-word')
    .execute(async (session, { word }) => {
      if (!(await ensureCommandAvailable(session, 'forbiddenWord'))) {
        return;
      }

      const forbiddenWord = word.trim();
      if (!forbiddenWord) {
        await replyIfNotSilent(session, msg`请提供要添加的违禁词：添加违禁词 词语`);
        return;
      }

      forbiddenWords.add(forbiddenWord);
      await saveListData();
      await replyIfNotSilent(session, msg`已添加违禁词：${forbiddenWord}`);
    });

  router
    .command('删除违禁词')
    .alias('word-del')
    .arg('word', param.greedy())
    .tag('group-admin:forbidden-word')
    .execute(async (session, { word }) => {
      if (!(await ensureCommandAvailable(session, 'forbiddenWord'))) {
        return;
      }

      const forbiddenWord = word.trim();
      if (!forbiddenWord) {
        await replyIfNotSilent(session, msg`请提供要删除的违禁词：删除违禁词 词语`);
        return;
      }

      if (!forbiddenWords.delete(forbiddenWord)) {
        await replyIfNotSilent(session, msg`违禁词不存在：${forbiddenWord}`);
        return;
      }

      await saveListData();
      await replyIfNotSilent(session, msg`已删除违禁词：${forbiddenWord}`);
    });

  router
    .command('踢人')
    .alias('kick', '踢')
    .arg('target', param.catchAll())
    .tag('group-admin:kick')
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
        api.get_group_member_info({
          group_id: session.raw.peer_id,
          user_id: targetUserId,
          no_cache: true,
        }),
        api.get_group_member_info({
          group_id: session.raw.peer_id,
          user_id: session.selfId,
          no_cache: true,
        }),
      ]);
      if (!canBotModerateTarget(botMember.role, member.role)) {
        await replyIfNotSilent(session, msg`机器人权限不足，无法踢出该成员`);
        return;
      }

      await api.kick_group_member({
        group_id: session.raw.peer_id,
        user_id: targetUserId,
        reject_add_request: false,
      });
      await replyIfNotSilent(session, msg`已踢出成员 ${targetUserId}`);
    });

  router
    .command('禁言')
    .alias('mute')
    .arg('target', param.catchAll())
    .tag('group-admin:mute')
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
        api.get_group_member_info({
          group_id: session.raw.peer_id,
          user_id: targetUserId,
          no_cache: true,
        }),
        api.get_group_member_info({
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
      await api.set_group_member_mute({
        group_id: session.raw.peer_id,
        user_id: targetUserId,
        duration,
      });
      await replyIfNotSilent(session, msg`已禁言成员 ${targetUserId} ${duration} 秒`);
    });

  router
    .command('撤回')
    .alias('recall')
    .arg('target', param.catchAll())
    .tag('group-admin:recall')
    .execute(async (session, { target }) => {
      await executeRecallCommand(session, target);
    });

  registerLiteralRawRoutes(router, ['撤回', 'recall'], async (session) => executeRecallCommand(session, []), [
    'group-admin:recall',
  ]);
  registerReplyLiteralCatchAllRawRoutes(
    router,
    ['撤回', 'recall'],
    async (session, reply, _literal, target) => executeRecallCommand(session, [reply, ...target]),
    ['group-admin:recall'],
  );
  registerReplyLiteralRawRoutes(
    router,
    ['撤回', 'recall'],
    async (session, reply) => executeRecallCommand(session, [reply]),
    ['group-admin:recall'],
  );

  return {
    isSilentEnabled,
    replyIfNotSilent,
    sendGroupMessageIfNotSilent,
    kickBlacklistedMember,
  };
}

export function registerJoinReviewCommands(runtime: GroupAdminRuntime, commands: JoinReviewCommands): void {
  const router = runtime.ctx.router.filter(
    (session) => session.raw.message_scene !== 'group' || runtime.isGroupInScope(session.raw.peer_id),
  );

  router.command('待审核入群').alias('入群审核列表', 'join-list').tag('group-admin:join-review').execute(commands.list);

  router
    .command('同意入群')
    .alias('approve-join')
    .arg('target', param.catchAll())
    .tag('group-admin:join-review')
    .execute((session, { target }) => commands.accept(session, target));

  registerReplyLiteralRawRoutes(router, ['y', 'n'], commands.decide, ['group-admin:join-review']);
}
