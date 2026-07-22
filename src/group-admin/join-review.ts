import { type Context, type milky, msg, type Session } from '@fraqjs/fraq';

import type { SchedulerService } from '../scheduler';
import type { GroupAdminApi, GroupMessage, SentGroupMessage } from './api';
import { type GroupAdminCommandKey, getGroupAdminCommandLabel } from './command-definitions';
import { getMessagePlainText, parseModerationTarget } from './data-processing';
import type { PendingJoinRequest } from './models';

type ReplySegment = Extract<milky.IncomingSegment, { type: 'reply' }>;

export interface JoinReviewCommands {
  list: (session: Session) => Promise<void>;
  accept: (session: Session, target: milky.IncomingSegment[]) => Promise<void>;
  decide: (session: Session, reply: ReplySegment, decision: 'y' | 'n') => Promise<void>;
}

function isPendingJoinRequestNotification(
  notification: milky.GroupNotification,
): notification is Extract<milky.GroupNotification, { type: 'join_request' }> {
  return notification.type === 'join_request' && notification.state === 'pending';
}

function getPendingJoinRequestKey(request: PendingJoinRequest): string {
  return `${request.groupId}:${request.isFiltered ? 'filtered' : 'normal'}:${request.notificationSeq}`;
}

function parseJoinRequestInitiatorId(segments: milky.IncomingSegment[]): number | undefined {
  const text = getMessagePlainText(segments);
  const accountMatch = /账号[：:]\s*(\d+)/u.exec(text);
  if (accountMatch) {
    return Number(accountMatch[1]);
  }

  const fallbackMatch = /\d{5,}/u.exec(text);
  return fallbackMatch ? Number(fallbackMatch[0]) : undefined;
}

function formatPendingJoinRequestList(requests: PendingJoinRequest[]): string {
  return requests.map((request) => String(request.initiatorId)).join('\n');
}

export function createJoinReview(options: {
  ctx: Context;
  scheduler: SchedulerService;
  api: GroupAdminApi;
  manualRejectionReason: string;
  reviewerUserIds: ReadonlySet<number>;
  pendingJoinRequests: Map<number, PendingJoinRequest>;
  pendingJoinRequestNotificationEnabled: boolean;
  pendingJoinRequestNotificationCron: string;
  listDataReady: Promise<void>;
  isGroupEnabled: (groupId: number) => boolean;
  areCommandsEnabled: (groupId: number) => boolean;
  isCommandFeatureEnabled: (groupId: number, commandKey: GroupAdminCommandKey) => boolean;
  replyIfNotSilent: (session: Session, content: Parameters<Session['reply']>[0]) => Promise<void>;
  sendGroupMessageIfNotSilent: (groupId: number, message: GroupMessage) => Promise<SentGroupMessage | undefined>;
}): JoinReviewCommands {
  const {
    ctx,
    scheduler,
    api,
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
  } = options;
  const notifiedPendingJoinRequests = new Set<string>();

  const canReviewJoinRequest = (session: Session): boolean =>
    session.raw.message_scene === 'group' &&
    (reviewerUserIds.has(session.raw.sender_id) || session.raw.group_member.role !== 'member');

  const listPendingJoinRequestsFromNotifications = async (groupId?: number): Promise<PendingJoinRequest[]> => {
    const requests: PendingJoinRequest[] = [];
    const seen = new Set<string>();

    for (const isFiltered of [false, true]) {
      let cursor: number | undefined;
      for (let page = 0; page < 5; page += 1) {
        const { notifications, next_notification_seq } = await api.get_group_notifications({
          start_notification_seq: cursor,
          is_filtered: isFiltered,
          limit: 50,
        });
        for (const notification of notifications) {
          if (!isPendingJoinRequestNotification(notification)) {
            continue;
          }

          if (groupId !== undefined && notification.group_id !== groupId) {
            continue;
          }

          const request = {
            groupId: notification.group_id,
            initiatorId: notification.initiator_id,
            notificationSeq: notification.notification_seq,
            isFiltered: notification.is_filtered,
          };
          const requestKey = getPendingJoinRequestKey(request);
          if (!seen.has(requestKey)) {
            seen.add(requestKey);
            requests.push(request);
          }
        }

        if (!next_notification_seq || next_notification_seq === cursor) {
          break;
        }

        cursor = next_notification_seq;
      }
    }

    return requests;
  };

  const findPendingJoinRequestFromNotifications = async (
    groupId: number,
    initiatorId: number,
  ): Promise<PendingJoinRequest | undefined> => {
    return (await listPendingJoinRequestsFromNotifications(groupId)).find(
      (request) => request.initiatorId === initiatorId,
    );
  };

  const clearPendingJoinRequestCache = (request: PendingJoinRequest) => {
    notifiedPendingJoinRequests.delete(getPendingJoinRequestKey(request));
    for (const [messageSeq, cachedRequest] of pendingJoinRequests) {
      if (cachedRequest.groupId === request.groupId && cachedRequest.initiatorId === request.initiatorId) {
        pendingJoinRequests.delete(messageSeq);
      }
    }
  };

  const sendPendingJoinRequestNotification = async (
    groupId: number,
    requests: PendingJoinRequest[],
  ): Promise<boolean> => {
    const sent = await sendGroupMessageIfNotSilent(
      groupId,
      msg`当前有待审核入群申请：
${formatPendingJoinRequestList(requests)}

发送 同意入群 QQ号 通过。`,
    );
    return sent !== undefined;
  };

  const ensureJoinReviewCommandAvailable = async (session: Session): Promise<boolean> => {
    await listDataReady;

    if (session.raw.message_scene !== 'group') {
      await replyIfNotSilent(session, msg`请在群聊中使用入群审核命令`);
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

    if (!isCommandFeatureEnabled(session.raw.peer_id, 'joinReview')) {
      await replyIfNotSilent(session, msg`本群 ${getGroupAdminCommandLabel('joinReview')} 命令已关闭`);
      return false;
    }

    if (!canReviewJoinRequest(session)) {
      await replyIfNotSilent(session, msg`你没有权限处理入群申请`);
      return false;
    }

    return true;
  };

  const executePendingJoinRequestListCommand = async (session: Session) => {
    if (!(await ensureJoinReviewCommandAvailable(session))) {
      return;
    }

    const requests = await listPendingJoinRequestsFromNotifications(session.raw.peer_id);
    if (requests.length === 0) {
      await replyIfNotSilent(session, msg`当前没有待审核入群申请`);
      return;
    }

    await replyIfNotSilent(
      session,
      msg`待审核入群申请 QQ 列表：
${formatPendingJoinRequestList(requests)}

发送 同意入群 QQ号 通过。`,
    );
  };

  const executeAcceptPendingJoinRequestCommand = async (session: Session, target: milky.IncomingSegment[]) => {
    if (!(await ensureJoinReviewCommandAvailable(session))) {
      return;
    }

    const initiatorId = parseModerationTarget(target);
    if (!initiatorId) {
      await replyIfNotSilent(session, msg`请提供要同意入群的 QQ 号：同意入群 QQ号`);
      return;
    }

    const request = await findPendingJoinRequestFromNotifications(session.raw.peer_id, initiatorId);
    if (!request) {
      await replyIfNotSilent(session, msg`没有找到 ${initiatorId} 的待审核入群申请`);
      return;
    }

    await api.accept_group_request({
      group_id: request.groupId,
      notification_seq: request.notificationSeq,
      notification_type: 'join_request',
      is_filtered: request.isFiltered,
    });
    clearPendingJoinRequestCache(request);
    await replyIfNotSilent(session, msg`已同意 ${request.initiatorId} 的入群申请`);
  };

  const resolvePendingJoinRequest = async (
    groupId: number,
    reply: Extract<milky.IncomingSegment, { type: 'reply' }>,
  ): Promise<PendingJoinRequest | undefined> => {
    const cachedRequest = pendingJoinRequests.get(reply.data.message_seq);
    if (cachedRequest?.groupId === groupId) {
      return cachedRequest;
    }

    const initiatorId = parseJoinRequestInitiatorId(reply.data.segments);
    if (!initiatorId) {
      return undefined;
    }

    return findPendingJoinRequestFromNotifications(groupId, initiatorId);
  };

  if (pendingJoinRequestNotificationEnabled) {
    scheduler.expression(pendingJoinRequestNotificationCron, async () => {
      try {
        await listDataReady;

        for (const request of pendingJoinRequests.values()) {
          notifiedPendingJoinRequests.add(getPendingJoinRequestKey(request));
        }

        const requests = await listPendingJoinRequestsFromNotifications();
        const activeRequestKeys = new Set(requests.map(getPendingJoinRequestKey));
        for (const requestKey of notifiedPendingJoinRequests) {
          if (!activeRequestKeys.has(requestKey)) {
            notifiedPendingJoinRequests.delete(requestKey);
          }
        }

        const { groups } = await api.get_group_list();
        const groupIds = new Set(groups.map((group) => group.group_id));
        const requestsByGroup = new Map<number, PendingJoinRequest[]>();
        for (const request of requests) {
          const requestKey = getPendingJoinRequestKey(request);
          if (
            !groupIds.has(request.groupId) ||
            !isGroupEnabled(request.groupId) ||
            !areCommandsEnabled(request.groupId) ||
            !isCommandFeatureEnabled(request.groupId, 'joinReview') ||
            notifiedPendingJoinRequests.has(requestKey)
          ) {
            continue;
          }

          const groupRequests = requestsByGroup.get(request.groupId) ?? [];
          groupRequests.push(request);
          requestsByGroup.set(request.groupId, groupRequests);
        }

        for (const [groupId, groupRequests] of requestsByGroup) {
          if (await sendPendingJoinRequestNotification(groupId, groupRequests)) {
            for (const request of groupRequests) {
              notifiedPendingJoinRequests.add(getPendingJoinRequestKey(request));
            }
          }
        }
      } catch (error) {
        ctx.logger.error('待审核入群申请通知失败', error);
      }
    });
  }

  const executeJoinReviewDecision = async (session: Session, reply: ReplySegment, decision: 'y' | 'n') => {
    await listDataReady;

    if (session.raw.message_scene !== 'group') {
      return;
    }

    if (
      !isGroupEnabled(session.raw.peer_id) ||
      !areCommandsEnabled(session.raw.peer_id) ||
      !isCommandFeatureEnabled(session.raw.peer_id, 'joinReview')
    ) {
      return;
    }

    const request = await resolvePendingJoinRequest(session.raw.peer_id, reply);
    if (!request) {
      return;
    }

    if (!canReviewJoinRequest(session)) {
      await replyIfNotSilent(session, msg`你没有权限处理入群申请`);
      return;
    }

    if (decision === 'y') {
      await api.accept_group_request({
        group_id: request.groupId,
        notification_seq: request.notificationSeq,
        notification_type: 'join_request',
        is_filtered: request.isFiltered,
      });
      clearPendingJoinRequestCache(request);
      await replyIfNotSilent(session, msg`已同意 ${request.initiatorId} 的入群申请`);
      return;
    }

    await api.reject_group_request({
      group_id: request.groupId,
      notification_seq: request.notificationSeq,
      notification_type: 'join_request',
      is_filtered: request.isFiltered,
      reason: manualRejectionReason,
    });
    clearPendingJoinRequestCache(request);
    await replyIfNotSilent(session, msg`已拒绝 ${request.initiatorId} 的入群申请`);
  };

  return {
    list: executePendingJoinRequestListCommand,
    accept: executeAcceptPendingJoinRequestCommand,
    decide: executeJoinReviewDecision,
  };
}
