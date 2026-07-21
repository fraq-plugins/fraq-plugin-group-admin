import { definePlugin, type milky, msg, param, type Session, seg } from '@fraqjs/fraq';

import { SchedulerService } from '../scheduler';
import {
  registerLiteralRawRoutes,
  registerReplyLiteralCatchAllRawRoutes,
  registerReplyLiteralRawRoutes,
} from './activation-routes';
import {
  type GroupAdminCommandKey,
  getGroupAdminCommandLabel,
  groupAdminCommandDefinitions,
  parseGroupAdminCommandKey,
} from './command-definitions';
import { createGroupAdminDataStore } from './data-store';
import { registerEventHandlers } from './event-handlers';
import { classifyRootGroupFiles } from './group-file-classification';
import { buildHelpMessageSections } from './help-message';
import { type PendingJoinRequest, registerJoinReview } from './join-review';
import { checkGroupMemberCards, type GroupMemberCardManagementOptions } from './member-card-management';
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
} from './message-utils';
import { registerScheduledTasks } from './scheduled-tasks';
import type { GroupAdminPluginOptions } from './types';

export type { GroupAdminPluginOptions } from './types';

export const GroupAdminPlugin = definePlugin({
  name: 'group-admin',
  inject: {
    scheduler: SchedulerService,
  },
  apply(ctx, options?: GroupAdminPluginOptions) {
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
    const forbiddenWordMuteDurationSeconds = options?.forbiddenWordMuteDurationSeconds ?? spamMuteDurationSeconds;
    const blacklistRejectionReason = options?.blacklistRejectionReason ?? '已被加入黑名单';
    const pendingJoinRequestNotificationEnabled = options?.pendingJoinRequestNotificationEnabled ?? true;
    const pendingJoinRequestNotificationCron = options?.pendingJoinRequestNotificationCron ?? '*/10 * * * *';
    const dataStore = createGroupAdminDataStore(ctx, {
      listDataPath: './data/data.json',
      blacklistUserIds: options?.blacklistUserIds,
      whitelistUserIds: options?.whitelistUserIds,
      forbiddenWords: options?.forbiddenWords,
    });
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
    const pendingJoinRequests = new Map<number, PendingJoinRequest>();
    const spamRecords = new Map<string, { timestamps: number[]; violationCount: number }>();

    const isGroupEnabled = (groupId: number): boolean => groupSwitches.get(groupId) ?? true;
    const areCommandsEnabled = (groupId: number): boolean => commandSwitches.get(groupId) ?? true;
    const isCommandFeatureEnabled = (groupId: number, commandKey: GroupAdminCommandKey): boolean =>
      commandFeatureSwitches.get(groupId)?.get(commandKey) ?? true;
    const isSilentEnabled = (groupId: number): boolean => silentSwitches.get(groupId) ?? false;
    const groupMemberCardManagement: GroupMemberCardManagementOptions = {
      enabled: options?.groupMemberCardManagementEnabled ?? false,
      ruleScope: options?.groupMemberCardRuleScope ?? 'global',
      pattern: options?.groupMemberCardPattern,
      groupPatterns: options?.groupMemberCardGroupPatterns,
      violationAction: options?.groupMemberCardViolationAction ?? 'notify',
    };

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

    const executeGroupFileClassificationCommand = async (session: Session) => {
      if (!(await ensureCommandAvailable(session, 'fileClassification'))) {
        return;
      }

      const { member: botMember } = await ctx.client.get_group_member_info({
        group_id: session.raw.peer_id,
        user_id: session.selfId,
        no_cache: true,
      });
      if (botMember.role === 'member') {
        await replyIfNotSilent(session, msg`机器人不是群主或管理员，无法移动群文件`);
        return;
      }

      const { moved, skipped, failed } = await classifyRootGroupFiles({
        ctx,
        groupId: session.raw.peer_id,
        mode: options?.groupFileClassificationMode,
        categories: options?.groupFileClassificationCategories,
        fallbackFolderName: options?.groupFileClassificationFallbackFolderName,
      });
      await replyIfNotSilent(session, msg`群文件分类完成：移动 ${moved} 个，跳过 ${skipped} 个，失败 ${failed} 个`);
    };

    const executeGroupMemberCardCheckCommand = async (session: Session) => {
      if (!(await ensureCommandAvailable(session, 'memberCard'))) {
        return;
      }

      const result = await checkGroupMemberCards({
        ctx,
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

    ctx.logger.info(`已载入插件：group-admin，入群最低 QQ 等级：${minimumAllowedLevel}`);
    registerScheduledTasks({
      ctx,
      inactiveCleanupCron: options?.inactiveCleanupCron,
      inactiveCleanupFreeSlotsThreshold,
      inactiveCleanupKickLimit,
      groupFileClassificationEnabled: options?.groupFileClassificationEnabled,
      groupFileClassificationMode: options?.groupFileClassificationMode,
      groupFileClassificationCron: options?.groupFileClassificationCron,
      groupFileClassificationCategories: options?.groupFileClassificationCategories,
      groupFileClassificationFallbackFolderName: options?.groupFileClassificationFallbackFolderName,
      groupMemberCardManagement,
      groupMemberCardCheckCron: options?.groupMemberCardCheckCron,
      memberCardSnapshots,
      saveListData,
      blacklistCleanupCron: options?.blacklistCleanupCron,
      listDataReady,
      isGroupEnabled,
      whitelistedUserIds,
      blacklistedUserIds,
      kickBlacklistedMember,
    });

    registerJoinReview({
      ctx,
      manualRejectionReason,
      reviewerUserIds,
      pendingJoinRequests,
      pendingJoinRequestNotificationEnabled,
      pendingJoinRequestNotificationCron,
      listDataReady,
      isGroupEnabled,
      areCommandsEnabled,
      isCommandFeatureEnabled,
      replyIfNotSilent,
      sendGroupMessageIfNotSilent,
    });

    ctx.router
      .command('help')
      .alias('帮助', '菜单')
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

    ctx.router
      .command('群开')
      .alias('群管开')
      .execute(async (session) => {
        await executeSwitchCommand(session, 'group', true);
      });

    ctx.router
      .command('群关')
      .alias('群管关')
      .execute(async (session) => {
        await executeSwitchCommand(session, 'group', false);
      });

    ctx.router
      .command('命令开')
      .arg('commandName', param.greedy())
      .execute(async (session, { commandName }) => {
        await executeCommandFeatureSwitchCommand(session, commandName, true);
      });

    ctx.router.command('命令开').execute(async (session) => {
      await executeSwitchCommand(session, 'command', true);
    });

    ctx.router
      .command('命令关')
      .arg('commandName', param.greedy())
      .execute(async (session, { commandName }) => {
        await executeCommandFeatureSwitchCommand(session, commandName, false);
      });

    ctx.router.command('命令关').execute(async (session) => {
      await executeSwitchCommand(session, 'command', false);
    });

    ctx.router.command('静默开').execute(async (session) => {
      await executeSwitchCommand(session, 'silent', true);
    });

    ctx.router.command('静默关').execute(async (session) => {
      await executeSwitchCommand(session, 'silent', false);
    });

    ctx.router.command('一键开').execute(async (session) => {
      await executeSwitchCommand(session, 'all', true);
    });

    ctx.router.command('一键关').execute(async (session) => {
      await executeSwitchCommand(session, 'all', false);
    });

    ctx.router
      .command('文件分类')
      .alias('群文件分类', 'file-classify')
      .execute(async (session) => {
        await executeGroupFileClassificationCommand(session);
      });

    ctx.router
      .command('名片检查')
      .alias('群名片检查', 'card-check')
      .execute(async (session) => {
        await executeGroupMemberCardCheckCommand(session);
      });

    ctx.router
      .command('添加黑名单')
      .alias('blacklist-add')
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
      .command('添加白名单')
      .alias('whitelist-add')
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
      .command('添加违禁词')
      .alias('word-add')
      .arg('word', param.greedy())
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

    ctx.router
      .command('删除违禁词')
      .alias('word-del')
      .arg('word', param.greedy())
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

    ctx.router
      .command('踢人')
      .alias('kick', '踢')
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
      .command('禁言')
      .alias('mute')
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
      .command('撤回')
      .alias('recall')
      .arg('target', param.catchAll())
      .execute(async (session, { target }) => {
        await executeRecallCommand(session, target);
      });

    registerLiteralRawRoutes(ctx.router, ['撤回', 'recall'], async (session) => {
      await executeRecallCommand(session, []);
    });
    registerReplyLiteralCatchAllRawRoutes(ctx.router, ['撤回', 'recall'], async (session, reply, _literal, target) => {
      await executeRecallCommand(session, [reply, ...target]);
    });
    registerReplyLiteralRawRoutes(ctx.router, ['撤回', 'recall'], async (session, reply) => {
      await executeRecallCommand(session, [reply]);
    });

    registerEventHandlers({
      ctx,
      minimumAllowedLevel,
      rejectionReason,
      blacklistRejectionReason,
      spamDetectionWindowMs,
      spamDetectionSegmentLimit,
      spamAction,
      spamMuteDurationSeconds,
      forbiddenWordMuteDurationSeconds,
      blacklistedUserIds,
      whitelistedUserIds,
      forbiddenWords,
      memberCardSnapshots,
      groupMemberCardManagement,
      pendingJoinRequests,
      spamRecords,
      listDataReady,
      saveListData,
      isGroupEnabled,
      isCommandFeatureEnabled,
      sendGroupMessageIfNotSilent,
      kickBlacklistedMember,
    });
  },
});

export default GroupAdminPlugin;
