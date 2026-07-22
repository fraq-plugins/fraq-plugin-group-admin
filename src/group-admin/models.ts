import type { Context } from '@fraqjs/fraq';

import type { SchedulerService } from '../scheduler';
import type { GroupAdminCommandKey } from './command-definitions';
import type { GroupFileClassificationCategories, GroupFileClassificationMode } from './group-file-classification';
import type { GroupMemberCardRuleScope, GroupMemberCardViolationAction } from './member-card-management';

export interface NormalizedGroupAdminConfig {
  groupIds: number[];
  dataPath: string;
  minimumAllowedLevel: number;
  rejectionReason: string;
  manualRejectionReason: string;
  reviewerUserIds: number[];
  moderatorUserIds: number[];
  joinReviewEnabled: boolean;
  pendingJoinRequestNotificationEnabled: boolean;
  pendingJoinRequestNotificationCron: string;
  groupFileClassificationEnabled: boolean;
  groupFileClassificationMode: GroupFileClassificationMode;
  groupFileClassificationCron: string;
  groupFileClassificationCategories?: GroupFileClassificationCategories;
  groupFileClassificationFallbackFolderName?: string;
  groupMemberCardManagementEnabled: boolean;
  groupMemberCardRuleScope: GroupMemberCardRuleScope;
  groupMemberCardPattern?: string;
  groupMemberCardGroupPatterns?: Record<string, string>;
  groupMemberCardViolationAction: GroupMemberCardViolationAction;
  groupMemberCardCheckCron: string;
  inactiveCleanupEnabled: boolean;
  inactiveCleanupCron: string;
  inactiveCleanupFreeSlotsThreshold: number;
  inactiveCleanupKickLimit: number;
  blacklistCleanupEnabled: boolean;
  blacklistCleanupCron: string;
  spamDetectionWindowMs: number;
  spamDetectionSegmentLimit: number;
  spamAction: 'kick' | 'mute';
  spamMuteDurationSeconds: number;
  manualMuteDurationSeconds: number;
  forbiddenWords: string[];
  forbiddenWordMuteDurationSeconds: number;
  blacklistUserIds: number[];
  blacklistRejectionReason: string;
  whitelistUserIds: number[];
}

export interface PendingJoinRequest {
  groupId: number;
  initiatorId: number;
  notificationSeq: number;
  isFiltered: boolean;
}

export interface SpamRecord {
  timestamps: number[];
  violationCount: number;
}

export interface GroupAdminDataStore {
  blacklistedUserIds: Set<number>;
  whitelistedUserIds: Set<number>;
  forbiddenWords: Set<string>;
  groupSwitches: Map<number, boolean>;
  commandSwitches: Map<number, boolean>;
  commandFeatureSwitches: Map<number, Map<GroupAdminCommandKey, boolean>>;
  silentSwitches: Map<number, boolean>;
  memberCardSnapshots: Map<number, Map<number, string>>;
  ready: Promise<void>;
  save: () => Promise<void>;
}

export type GroupAdminContext = Context;

export interface GroupAdminRuntime {
  ctx: GroupAdminContext;
  scheduler: SchedulerService;
  config: NormalizedGroupAdminConfig;
  store: GroupAdminDataStore;
  pendingJoinRequests: Map<number, PendingJoinRequest>;
  spamRecords: Map<string, SpamRecord>;
  isGroupInScope: (groupId: number) => boolean;
  isGroupEnabled: (groupId: number) => boolean;
  areCommandsEnabled: (groupId: number) => boolean;
  isCommandFeatureEnabled: (groupId: number, commandKey: GroupAdminCommandKey) => boolean;
}
