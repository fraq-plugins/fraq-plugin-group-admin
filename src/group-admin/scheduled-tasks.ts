import type { Context } from '@fraqjs/fraq';

import type { SchedulerService } from '../scheduler';
import {
  classifyRootGroupFiles,
  type GroupFileClassificationCategories,
  type GroupFileClassificationMode,
} from './group-file-classification';
import { checkGroupMemberCards, type GroupMemberCardManagementOptions } from './member-card-management';

type GroupAdminContext = Context & { scheduler: SchedulerService };

export function registerScheduledTasks(options: {
  ctx: GroupAdminContext;
  inactiveCleanupCron?: string;
  inactiveCleanupFreeSlotsThreshold: number;
  inactiveCleanupKickLimit: number;
  groupFileClassificationEnabled?: boolean;
  groupFileClassificationMode?: GroupFileClassificationMode;
  groupFileClassificationCron?: string;
  groupFileClassificationCategories?: GroupFileClassificationCategories;
  groupFileClassificationFallbackFolderName?: string;
  groupMemberCardManagement: GroupMemberCardManagementOptions;
  groupMemberCardCheckCron?: string;
  memberCardSnapshots: Map<number, Map<number, string>>;
  saveListData: () => Promise<void>;
  blacklistCleanupCron?: string;
  listDataReady: Promise<void>;
  isGroupEnabled: (groupId: number) => boolean;
  whitelistedUserIds: ReadonlySet<number>;
  blacklistedUserIds: ReadonlySet<number>;
  kickBlacklistedMember: (groupId: number, userId: number, selfId: number, source: string) => Promise<boolean>;
}): void {
  const {
    ctx,
    inactiveCleanupCron,
    inactiveCleanupFreeSlotsThreshold,
    inactiveCleanupKickLimit,
    groupFileClassificationEnabled,
    groupFileClassificationMode,
    groupFileClassificationCron,
    groupFileClassificationCategories,
    groupFileClassificationFallbackFolderName,
    groupMemberCardManagement,
    groupMemberCardCheckCron,
    memberCardSnapshots,
    saveListData,
    blacklistCleanupCron,
    listDataReady,
    isGroupEnabled,
    whitelistedUserIds,
    blacklistedUserIds,
    kickBlacklistedMember,
  } = options;

  if (groupMemberCardManagement.enabled) {
    ctx.scheduler.expression(groupMemberCardCheckCron ?? '0 1 * * *', async () => {
      try {
        await listDataReady;

        const { uin } = await ctx.client.get_login_info();
        const { groups } = await ctx.client.get_group_list();
        for (const group of groups) {
          if (!isGroupEnabled(group.group_id)) {
            continue;
          }

          const result = await checkGroupMemberCards({
            ctx,
            groupId: group.group_id,
            botUserId: uin,
            cardSnapshots: memberCardSnapshots,
            management: groupMemberCardManagement,
          });
          ctx.logger.info(
            `群名片检查完成：群 ${group.group_id}，检查 ${result.checked} 人，改动 ${result.changed} 人，违规 ${result.invalid} 人，恢复 ${result.reset} 人，失败 ${result.failed} 人`,
          );
        }

        await saveListData();
      } catch (error) {
        ctx.logger.error('每日群名片检查失败', error);
      }
    });
  }

  if (groupFileClassificationEnabled ?? true) {
    ctx.scheduler.expression(groupFileClassificationCron ?? '0 2 * * *', async () => {
      try {
        await listDataReady;

        const { uin } = await ctx.client.get_login_info();
        const { groups } = await ctx.client.get_group_list();
        for (const group of groups) {
          if (!isGroupEnabled(group.group_id)) {
            continue;
          }

          const { member: botMember } = await ctx.client.get_group_member_info({
            group_id: group.group_id,
            user_id: uin,
            no_cache: true,
          });
          if (botMember.role === 'member') {
            ctx.logger.warn(`群文件分类跳过：机器人不是群主或管理员，群 ${group.group_id}`);
            continue;
          }

          const { moved, skipped, failed } = await classifyRootGroupFiles({
            ctx,
            groupId: group.group_id,
            mode: groupFileClassificationMode,
            categories: groupFileClassificationCategories,
            fallbackFolderName: groupFileClassificationFallbackFolderName,
          });
          ctx.logger.info(
            `群文件分类完成：群 ${group.group_id}，移动 ${moved} 个，跳过 ${skipped} 个，失败 ${failed} 个`,
          );
        }
      } catch (error) {
        ctx.logger.error('每日群文件分类失败', error);
      }
    });
  }

  ctx.scheduler.expression(inactiveCleanupCron ?? '0 4 * * *', async () => {
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

  ctx.scheduler.expression(blacklistCleanupCron ?? '0 3 * * *', async () => {
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
}
