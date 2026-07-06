import { type Context, type milky, msg, seg } from '@fraqjs/fraq';

import { canBotModerateTarget } from './message-utils';

export type GroupMemberCardRuleScope = 'global' | 'group';
export type GroupMemberCardViolationAction = 'notify' | 'reset';

export interface GroupMemberCardManagementOptions {
  enabled?: boolean;
  ruleScope?: GroupMemberCardRuleScope;
  pattern?: string;
  groupPatterns?: Record<string, string>;
  violationAction?: GroupMemberCardViolationAction;
}

export interface GroupMemberCardCheckResult {
  checked: number;
  changed: number;
  invalid: number;
  reset: number;
  failed: number;
}

type GroupMemberCardContext = Pick<Context, 'client' | 'logger'>;

export function getGroupMemberCardPattern(
  groupId: number,
  options: GroupMemberCardManagementOptions,
): string | undefined {
  if (options.ruleScope === 'group') {
    return options.groupPatterns?.[String(groupId)];
  }

  return options.pattern;
}

function compilePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern?.trim()) {
    return undefined;
  }

  return new RegExp(pattern);
}

function getStoredGroupCards(cardSnapshots: Map<number, Map<number, string>>, groupId: number): Map<number, string> {
  const groupCards = cardSnapshots.get(groupId) ?? new Map<number, string>();
  cardSnapshots.set(groupId, groupCards);
  return groupCards;
}

function isCardValid(card: string, pattern: RegExp | undefined): boolean {
  return !pattern || pattern.test(card);
}

async function resetMemberCard(options: {
  ctx: GroupMemberCardContext;
  groupId: number;
  member: milky.GroupMemberEntity;
  botRole: milky.GroupMemberEntity['role'];
  card: string;
}): Promise<boolean> {
  const { ctx, groupId, member, botRole, card } = options;
  if (!canBotModerateTarget(botRole, member.role)) {
    return false;
  }

  await ctx.client.set_group_member_card({
    group_id: groupId,
    user_id: member.user_id,
    card,
  });
  return true;
}

export async function checkGroupMemberCards(options: {
  ctx: GroupMemberCardContext;
  groupId: number;
  botUserId: number;
  cardSnapshots: Map<number, Map<number, string>>;
  management: GroupMemberCardManagementOptions;
  notify?: (message: ReturnType<typeof msg>) => Promise<void>;
}): Promise<GroupMemberCardCheckResult> {
  const { ctx, groupId, botUserId, cardSnapshots, management, notify } = options;
  const pattern = compilePattern(getGroupMemberCardPattern(groupId, management));
  const violationAction = management.violationAction ?? 'notify';
  const groupCards = getStoredGroupCards(cardSnapshots, groupId);
  const { member: botMember } = await ctx.client.get_group_member_info({
    group_id: groupId,
    user_id: botUserId,
    no_cache: true,
  });
  const { members } = await ctx.client.get_group_member_list({
    group_id: groupId,
    no_cache: true,
  });
  const result: GroupMemberCardCheckResult = {
    checked: 0,
    changed: 0,
    invalid: 0,
    reset: 0,
    failed: 0,
  };

  for (const member of members) {
    if (member.user_id === botUserId) {
      continue;
    }

    result.checked += 1;
    const currentCard = member.card.trim();
    const previousCard = groupCards.get(member.user_id);
    const hasChanged = previousCard !== undefined && previousCard !== currentCard;
    if (hasChanged) {
      result.changed += 1;
      ctx.logger.info(
        `群名片改动：群 ${groupId}，用户 ${member.user_id}，${previousCard || '空'} -> ${currentCard || '空'}`,
      );
    }

    if (isCardValid(currentCard, pattern)) {
      groupCards.set(member.user_id, currentCard);
      continue;
    }

    result.invalid += 1;
    if (violationAction !== 'reset' || !previousCard || !isCardValid(previousCard, pattern)) {
      groupCards.set(member.user_id, currentCard);
      if (hasChanged && notify) {
        await notify(msg`${seg.mention(member.user_id)} 群名片不符合规则，请修改后重新发送消息。`);
      }
      continue;
    }

    try {
      const didReset = await resetMemberCard({
        ctx,
        groupId,
        member,
        botRole: botMember.role,
        card: previousCard,
      });
      if (didReset) {
        groupCards.set(member.user_id, previousCard);
        result.reset += 1;
        if (notify) {
          await notify(msg`${seg.mention(member.user_id)} 群名片不符合规则，已恢复为上一次合规名片。`);
        }
      } else {
        groupCards.set(member.user_id, currentCard);
      }
    } catch (error) {
      result.failed += 1;
      groupCards.set(member.user_id, currentCard);
      ctx.logger.error(`恢复群名片失败：群 ${groupId}，用户 ${member.user_id}`, error);
    }
  }

  return result;
}

export async function observeGroupMemberCard(options: {
  ctx: GroupMemberCardContext;
  groupId: number;
  botUserId: number;
  member: milky.GroupMemberEntity;
  cardSnapshots: Map<number, Map<number, string>>;
  management: GroupMemberCardManagementOptions;
  notify?: (message: ReturnType<typeof msg>) => Promise<void>;
}): Promise<void> {
  const { ctx, groupId, botUserId, member, cardSnapshots, management, notify } = options;
  if (member.user_id === botUserId) {
    return;
  }

  const groupCards = getStoredGroupCards(cardSnapshots, groupId);
  const currentCard = member.card.trim();
  const previousCard = groupCards.get(member.user_id);
  if (previousCard === currentCard) {
    return;
  }

  await checkGroupMemberCards({
    ctx,
    groupId,
    botUserId,
    cardSnapshots,
    management,
    notify,
  });
}
