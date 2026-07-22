import { validateCronExpression } from '../scheduler';
import type { NormalizedGroupAdminConfig } from './models';
import type { GroupAdminPluginOptions } from './types';

function fail(name: string, expected: string): never {
  throw new TypeError(`group-admin 配置 ${name} 无效，应为${expected}`);
}

function optionalBoolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail(name, '布尔值');
  return value;
}

function optionalString(value: unknown, name: string, fallback?: string): string | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim()) fail(name, '非空字符串');
  return value;
}

function optionalInteger(value: unknown, name: string, fallback: number, minimum = 0): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < minimum) fail(name, `不小于 ${minimum} 的整数`);
  return value as number;
}

function optionalIntegerArray(value: unknown, name: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => !Number.isSafeInteger(item) || item <= 0)) {
    fail(name, '正整数数组');
  }
  return [...new Set(value as number[])];
}

function optionalStringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    fail(name, '非空字符串数组');
  }
  return [...new Set((value as string[]).map((item) => item.trim()))];
}

function enumValue<T extends string>(value: unknown, name: string, values: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !values.includes(value as T)) fail(name, values.join('、'));
  return value as T;
}

function cron(value: unknown, name: string, fallback: string): string {
  const result = optionalString(value, name, fallback) as string;
  try {
    validateCronExpression(result);
  } catch (error) {
    throw new TypeError(`group-admin 配置 ${name} 无效：${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

function optionalRegex(value: unknown, name: string): string | undefined {
  const pattern = optionalString(value, name);
  if (pattern === undefined) return undefined;
  try {
    new RegExp(pattern);
  } catch (error) {
    throw new TypeError(
      `group-admin 配置 ${name} 不是有效正则：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return pattern;
}

function regexRecord(value: unknown, name: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(name, '群号到正则字符串的对象');
  const result: Record<string, string> = {};
  for (const [groupId, pattern] of Object.entries(value)) {
    if (!Number.isSafeInteger(Number(groupId)) || Number(groupId) <= 0 || typeof pattern !== 'string') {
      fail(name, '群号到正则字符串的对象');
    }
    result[groupId] = optionalRegex(pattern, `${name}.${groupId}`) as string;
  }
  return result;
}

function classificationCategories(value: unknown): Record<string, string[]> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('groupFileClassificationCategories', '目录名到扩展名数组的对象');
  }
  const result: Record<string, string[]> = {};
  for (const [folder, extensions] of Object.entries(value)) {
    if (!folder.trim()) fail('groupFileClassificationCategories', '非空目录名到扩展名数组的对象');
    result[folder] = optionalStringArray(extensions, `groupFileClassificationCategories.${folder}`);
  }
  return result;
}

export function normalizeGroupAdminConfig(value: unknown): NormalizedGroupAdminConfig {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
    fail('根配置', '对象');
  }
  const options = (value ?? {}) as GroupAdminPluginOptions;
  const minimumAllowedLevel = optionalInteger(options.minimumAllowedLevel, 'minimumAllowedLevel', 5);
  const spamMuteDurationSeconds = optionalInteger(options.spamMuteDurationSeconds, 'spamMuteDurationSeconds', 600, 1);
  const reviewerUserIds = optionalIntegerArray(options.reviewerUserIds, 'reviewerUserIds');

  return {
    groupIds: optionalIntegerArray(options.groupIds, 'groupIds'),
    dataPath: optionalString(options.dataPath, 'dataPath', './data/data.json') as string,
    minimumAllowedLevel,
    rejectionReason:
      optionalString(options.rejectionReason, 'rejectionReason') ?? `QQ 等级低于 ${minimumAllowedLevel}，暂不允许入群`,
    manualRejectionReason: optionalString(
      options.manualRejectionReason,
      'manualRejectionReason',
      '管理员拒绝入群',
    ) as string,
    reviewerUserIds,
    moderatorUserIds:
      options.moderatorUserIds === undefined
        ? reviewerUserIds
        : optionalIntegerArray(options.moderatorUserIds, 'moderatorUserIds'),
    joinReviewEnabled: optionalBoolean(options.joinReviewEnabled, 'joinReviewEnabled', false),
    pendingJoinRequestNotificationEnabled: optionalBoolean(
      options.pendingJoinRequestNotificationEnabled,
      'pendingJoinRequestNotificationEnabled',
      false,
    ),
    pendingJoinRequestNotificationCron: cron(
      options.pendingJoinRequestNotificationCron,
      'pendingJoinRequestNotificationCron',
      '*/10 * * * *',
    ),
    groupFileClassificationEnabled: optionalBoolean(
      options.groupFileClassificationEnabled,
      'groupFileClassificationEnabled',
      false,
    ),
    groupFileClassificationMode: enumValue(
      options.groupFileClassificationMode,
      'groupFileClassificationMode',
      ['extension', 'category'],
      'extension',
    ),
    groupFileClassificationCron: cron(options.groupFileClassificationCron, 'groupFileClassificationCron', '0 2 * * *'),
    groupFileClassificationCategories: classificationCategories(options.groupFileClassificationCategories),
    groupFileClassificationFallbackFolderName: optionalString(
      options.groupFileClassificationFallbackFolderName,
      'groupFileClassificationFallbackFolderName',
    ),
    groupMemberCardManagementEnabled: optionalBoolean(
      options.groupMemberCardManagementEnabled,
      'groupMemberCardManagementEnabled',
      false,
    ),
    groupMemberCardRuleScope: enumValue(
      options.groupMemberCardRuleScope,
      'groupMemberCardRuleScope',
      ['global', 'group'],
      'global',
    ),
    groupMemberCardPattern: optionalRegex(options.groupMemberCardPattern, 'groupMemberCardPattern'),
    groupMemberCardGroupPatterns: regexRecord(options.groupMemberCardGroupPatterns, 'groupMemberCardGroupPatterns'),
    groupMemberCardViolationAction: enumValue(
      options.groupMemberCardViolationAction,
      'groupMemberCardViolationAction',
      ['notify', 'reset'],
      'notify',
    ),
    groupMemberCardCheckCron: cron(options.groupMemberCardCheckCron, 'groupMemberCardCheckCron', '0 1 * * *'),
    inactiveCleanupEnabled: optionalBoolean(options.inactiveCleanupEnabled, 'inactiveCleanupEnabled', false),
    inactiveCleanupCron: cron(options.inactiveCleanupCron, 'inactiveCleanupCron', '0 4 * * *'),
    inactiveCleanupFreeSlotsThreshold: optionalInteger(
      options.inactiveCleanupFreeSlotsThreshold,
      'inactiveCleanupFreeSlotsThreshold',
      9,
    ),
    inactiveCleanupKickLimit: optionalInteger(options.inactiveCleanupKickLimit, 'inactiveCleanupKickLimit', 100, 1),
    blacklistCleanupEnabled: optionalBoolean(options.blacklistCleanupEnabled, 'blacklistCleanupEnabled', false),
    blacklistCleanupCron: cron(options.blacklistCleanupCron, 'blacklistCleanupCron', '0 3 * * *'),
    spamDetectionWindowMs: optionalInteger(options.spamDetectionWindowMs, 'spamDetectionWindowMs', 10_000, 1),
    spamDetectionSegmentLimit: optionalInteger(options.spamDetectionSegmentLimit, 'spamDetectionSegmentLimit', 8, 1),
    spamAction: enumValue(options.spamAction, 'spamAction', ['kick', 'mute'], 'mute'),
    spamMuteDurationSeconds,
    manualMuteDurationSeconds: optionalInteger(
      options.manualMuteDurationSeconds,
      'manualMuteDurationSeconds',
      spamMuteDurationSeconds,
      1,
    ),
    forbiddenWords: optionalStringArray(options.forbiddenWords, 'forbiddenWords'),
    forbiddenWordMuteDurationSeconds: optionalInteger(
      options.forbiddenWordMuteDurationSeconds,
      'forbiddenWordMuteDurationSeconds',
      spamMuteDurationSeconds,
      1,
    ),
    blacklistUserIds: optionalIntegerArray(options.blacklistUserIds, 'blacklistUserIds'),
    blacklistRejectionReason: optionalString(
      options.blacklistRejectionReason,
      'blacklistRejectionReason',
      '已被加入黑名单',
    ) as string,
    whitelistUserIds: optionalIntegerArray(options.whitelistUserIds, 'whitelistUserIds'),
  };
}
