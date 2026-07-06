export interface GroupAdminPluginOptions {
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
  forbiddenWords?: string[];
  forbiddenWordMuteDurationSeconds?: number;
  blacklistUserIds?: number[];
  blacklistRejectionReason?: string;
  blacklistCleanupCron?: string;
  whitelistUserIds?: number[];
}
