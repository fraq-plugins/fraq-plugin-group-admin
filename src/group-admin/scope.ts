import type { milky } from '@fraqjs/fraq';

export function createGroupScope(groupIds: readonly number[]): {
  includes: (groupId: number) => boolean;
  filter: (groups: readonly milky.GroupEntity[]) => milky.GroupEntity[];
} {
  const allowed = new Set(groupIds);
  return {
    includes: (groupId) => allowed.has(groupId),
    filter: (groups) => groups.filter((group) => allowed.has(group.group_id)),
  };
}
