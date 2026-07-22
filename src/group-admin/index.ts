import { definePlugin } from '@fraqjs/fraq';

import { SchedulerService } from '../scheduler';
import { createGroupAdminApi } from './api';
import { registerGroupAdminCommands, registerJoinReviewCommands } from './commands';
import { normalizeGroupAdminConfig } from './config';
import { createGroupAdminDataStore } from './data-store';
import { registerEventHandlers } from './event-handlers';
import { createJoinReview } from './join-review';
import type { GroupMemberCardManagementOptions } from './member-card-management';
import type { GroupAdminRuntime } from './models';
import { registerScheduledTasks } from './scheduled-tasks';
import { createGroupScope } from './scope';
import type { GroupAdminPluginOptions } from './types';

export type { GroupAdminPluginOptions } from './types';

export const GroupAdminPlugin = definePlugin({
  name: 'group-admin',
  async apply(ctx, options?: GroupAdminPluginOptions) {
    const config = normalizeGroupAdminConfig(options);
    const scheduler = new SchedulerService(ctx);
    const api = createGroupAdminApi(ctx.client);
    const store = createGroupAdminDataStore(ctx, {
      listDataPath: config.dataPath,
      blacklistUserIds: config.blacklistUserIds,
      whitelistUserIds: config.whitelistUserIds,
      forbiddenWords: config.forbiddenWords,
    });
    await store.ready;

    const scope = createGroupScope(config.groupIds);
    const runtime: GroupAdminRuntime = {
      ctx,
      scheduler,
      config,
      store,
      pendingJoinRequests: new Map(),
      spamRecords: new Map(),
      isGroupInScope: scope.includes,
      isGroupEnabled: (groupId) => scope.includes(groupId) && (store.groupSwitches.get(groupId) ?? true),
      areCommandsEnabled: (groupId) => store.commandSwitches.get(groupId) ?? true,
      isCommandFeatureEnabled: (groupId, commandKey) =>
        store.commandFeatureSwitches.get(groupId)?.get(commandKey) ?? true,
    };
    const groupMemberCardManagement: GroupMemberCardManagementOptions = {
      enabled: config.groupMemberCardManagementEnabled,
      ruleScope: config.groupMemberCardRuleScope,
      pattern: config.groupMemberCardPattern,
      groupPatterns: config.groupMemberCardGroupPatterns,
      violationAction: config.groupMemberCardViolationAction,
    };

    const commandServices = registerGroupAdminCommands(runtime, api, groupMemberCardManagement);

    if (config.joinReviewEnabled) {
      const joinReviewCommands = createJoinReview({
        ctx,
        scheduler,
        api,
        manualRejectionReason: config.manualRejectionReason,
        reviewerUserIds: new Set(config.reviewerUserIds),
        pendingJoinRequests: runtime.pendingJoinRequests,
        pendingJoinRequestNotificationEnabled: config.pendingJoinRequestNotificationEnabled,
        pendingJoinRequestNotificationCron: config.pendingJoinRequestNotificationCron,
        listDataReady: store.ready,
        isGroupEnabled: runtime.isGroupEnabled,
        areCommandsEnabled: runtime.areCommandsEnabled,
        isCommandFeatureEnabled: runtime.isCommandFeatureEnabled,
        replyIfNotSilent: commandServices.replyIfNotSilent,
        sendGroupMessageIfNotSilent: commandServices.sendGroupMessageIfNotSilent,
      });
      registerJoinReviewCommands(runtime, joinReviewCommands);
    }

    registerScheduledTasks({
      runtime,
      api,
      groupMemberCardManagement,
      kickBlacklistedMember: commandServices.kickBlacklistedMember,
    });

    registerEventHandlers({
      ctx,
      api,
      joinReviewEnabled: config.joinReviewEnabled,
      minimumAllowedLevel: config.minimumAllowedLevel,
      rejectionReason: config.rejectionReason,
      blacklistRejectionReason: config.blacklistRejectionReason,
      spamDetectionWindowMs: config.spamDetectionWindowMs,
      spamDetectionSegmentLimit: config.spamDetectionSegmentLimit,
      spamAction: config.spamAction,
      spamMuteDurationSeconds: config.spamMuteDurationSeconds,
      forbiddenWordMuteDurationSeconds: config.forbiddenWordMuteDurationSeconds,
      blacklistedUserIds: store.blacklistedUserIds,
      whitelistedUserIds: store.whitelistedUserIds,
      forbiddenWords: store.forbiddenWords,
      memberCardSnapshots: store.memberCardSnapshots,
      groupMemberCardManagement,
      pendingJoinRequests: runtime.pendingJoinRequests,
      spamRecords: runtime.spamRecords,
      listDataReady: store.ready,
      saveListData: store.save,
      isGroupEnabled: runtime.isGroupEnabled,
      isCommandFeatureEnabled: runtime.isCommandFeatureEnabled,
      sendGroupMessageIfNotSilent: commandServices.sendGroupMessageIfNotSilent,
      kickBlacklistedMember: commandServices.kickBlacklistedMember,
    });

    if (config.groupIds.length === 0) {
      ctx.logger.warn('group-admin 未配置 groupIds；为避免 CLI fork 作用域泄漏，本实例不会管理任何群');
    }
    ctx.logger.info(`已载入插件：group-admin，作用域群数：${config.groupIds.length}`);
  },
});

export default GroupAdminPlugin;
