import type { Context } from '@fraqjs/fraq';

import type { SchedulerService } from '../scheduler';

type GroupAdminContext = Context & { scheduler: SchedulerService };

export function registerScheduledTasks(options: {
  ctx: GroupAdminContext;
  inactiveCleanupCron?: string;
  inactiveCleanupFreeSlotsThreshold: number;
  inactiveCleanupKickLimit: number;
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
    blacklistCleanupCron,
    listDataReady,
    isGroupEnabled,
    whitelistedUserIds,
    blacklistedUserIds,
    kickBlacklistedMember,
  } = options;

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
