export interface GroupAdminPluginOptions {
  /** Explicit groups managed by this plugin instance. An empty or omitted list is fail-closed. */
  groupIds?: number[];
  /** Resolved from the Fraq CLI app working directory. */
  dataPath?: string;
  minimumAllowedLevel?: number;
  rejectionReason?: string;
  manualRejectionReason?: string;
  reviewerUserIds?: number[];
  moderatorUserIds?: number[];
  joinReviewEnabled?: boolean;
  pendingJoinRequestNotificationEnabled?: boolean;
  pendingJoinRequestNotificationCron?: string;
  groupFileClassificationEnabled?: boolean;
  groupFileClassificationMode?: 'extension' | 'category';
  groupFileClassificationCron?: string;
  groupFileClassificationCategories?: Record<string, string[]>;
  groupFileClassificationFallbackFolderName?: string;
  groupMemberCardManagementEnabled?: boolean;
  groupMemberCardRuleScope?: 'global' | 'group';
  groupMemberCardPattern?: string;
  groupMemberCardGroupPatterns?: Record<string, string>;
  groupMemberCardViolationAction?: 'notify' | 'reset';
  groupMemberCardCheckCron?: string;
  inactiveCleanupEnabled?: boolean;
  inactiveCleanupCron?: string;
  inactiveCleanupFreeSlotsThreshold?: number;
  inactiveCleanupKickLimit?: number;
  spamDetectionWindowMs?: number;
  spamDetectionSegmentLimit?: number;
  spamAction?: 'kick' | 'mute';
  spamMuteDurationSeconds?: number;
  manualMuteDurationSeconds?: number;
  forbiddenWords?: string[];
  forbiddenWordMuteDurationSeconds?: number;
  blacklistUserIds?: number[];
  blacklistRejectionReason?: string;
  blacklistCleanupEnabled?: boolean;
  blacklistCleanupCron?: string;
  whitelistUserIds?: number[];
}
