import { type Context, msg, seg } from '@fraqjs/fraq';

import type { GroupAdminCommandKey } from './command-definitions';
import { canBotModerateTarget, getMessagePlainText } from './message-utils';

export function registerEventHandlers(options: {
  ctx: Context;
  minimumAllowedLevel: number;
  rejectionReason: string;
  blacklistRejectionReason: string;
  spamDetectionWindowMs: number;
  spamDetectionSegmentLimit: number;
  spamAction: 'kick' | 'mute';
  spamMuteDurationSeconds: number;
  forbiddenWordMuteDurationSeconds: number;
  blacklistedUserIds: ReadonlySet<number>;
  whitelistedUserIds: ReadonlySet<number>;
  forbiddenWords: ReadonlySet<string>;
  pendingJoinRequests: Map<
    number,
    {
      groupId: number;
      initiatorId: number;
      notificationSeq: number;
      isFiltered: boolean;
    }
  >;
  spamRecords: Map<string, { timestamps: number[]; violationCount: number }>;
  listDataReady: Promise<void>;
  isGroupEnabled: (groupId: number) => boolean;
  isCommandFeatureEnabled: (groupId: number, commandKey: GroupAdminCommandKey) => boolean;
  sendGroupMessageIfNotSilent: (
    groupId: number,
    message: Parameters<Context['client']['send_group_message']>[0]['message'],
  ) => Promise<Awaited<ReturnType<Context['client']['send_group_message']>> | undefined>;
  kickBlacklistedMember: (groupId: number, userId: number, selfId: number, source: string) => Promise<boolean>;
}): void {
  const {
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
    pendingJoinRequests,
    spamRecords,
    listDataReady,
    isGroupEnabled,
    isCommandFeatureEnabled,
    sendGroupMessageIfNotSilent,
    kickBlacklistedMember,
  } = options;

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

      const messageText = getMessagePlainText(data.segments);
      if (data.group_member.role !== 'member') {
        return;
      }

      if (forbiddenWords.size > 0 && isCommandFeatureEnabled(data.peer_id, 'forbiddenWord')) {
        const matchedForbiddenWord = [...forbiddenWords].find((word) => messageText.includes(word));
        if (matchedForbiddenWord) {
          const { member: botMember } = await ctx.client.get_group_member_info({
            group_id: data.peer_id,
            user_id: self_id,
            no_cache: true,
          });
          if (!canBotModerateTarget(botMember.role, data.group_member.role)) {
            ctx.logger.warn(`违禁词禁言跳过：机器人权限不足，群 ${data.peer_id}，用户 ${data.sender_id}`);
            return;
          }

          await ctx.client.set_group_member_mute({
            group_id: data.peer_id,
            user_id: data.sender_id,
            duration: forbiddenWordMuteDurationSeconds,
          });
          await sendGroupMessageIfNotSilent(
            data.peer_id,
            msg`${seg.mention(data.sender_id)} 触发违禁词，已禁言 ${forbiddenWordMuteDurationSeconds} 秒`,
          );
          ctx.logger.info(
            `已禁言触发违禁词成员：群 ${data.peer_id}，用户 ${data.sender_id}，违禁词 ${matchedForbiddenWord}`,
          );
          return;
        }
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
          ctx.logger.info(`静默模式已跳过入群审核通知：群 ${group_id}，用户 ${initiator_id}，QQ 等级 ${profile.level}`);
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
}
