export type GroupAdminCommandKey =
  | 'title'
  | 'blacklist'
  | 'whitelist'
  | 'forbiddenWord'
  | 'fileClassification'
  | 'memberCard'
  | 'kick'
  | 'mute'
  | 'recall';

export const groupAdminCommandDefinitions: {
  key: GroupAdminCommandKey;
  label: string;
  names: readonly string[];
}[] = [
  { key: 'title', label: 'title', names: ['title', '头衔', '专属头衔'] },
  { key: 'blacklist', label: '添加黑名单', names: ['添加黑名单', '黑名单', 'blacklist-add'] },
  { key: 'whitelist', label: '添加白名单', names: ['添加白名单', '白名单', 'whitelist-add'] },
  { key: 'forbiddenWord', label: '违禁词', names: ['添加违禁词', '删除违禁词', '违禁词', 'word-add', 'word-del'] },
  { key: 'fileClassification', label: '文件分类', names: ['文件分类', '群文件分类', 'file-classify'] },
  { key: 'memberCard', label: '名片检查', names: ['名片检查', '群名片检查', 'card-check'] },
  { key: 'kick', label: '踢人', names: ['踢人', '踢', 'kick'] },
  { key: 'mute', label: '禁言', names: ['禁言', 'mute'] },
  { key: 'recall', label: '撤回', names: ['撤回', 'recall'] },
];

const commandNameMap = new Map(
  groupAdminCommandDefinitions.flatMap(({ key, names }) =>
    names.map((name) => [name.toLocaleLowerCase(), key] as const),
  ),
);

export function parseGroupAdminCommandKey(text: string): GroupAdminCommandKey | undefined {
  return commandNameMap.get(text.trim().toLocaleLowerCase());
}

export function getGroupAdminCommandLabel(key: GroupAdminCommandKey): string {
  return groupAdminCommandDefinitions.find((definition) => definition.key === key)?.label ?? key;
}

export function addCommandSwitchRecordToMap(
  value: unknown,
  target: Map<number, Map<GroupAdminCommandKey, boolean>>,
): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [groupIdText, item] of Object.entries(value)) {
    const groupId = Number(groupIdText);
    if (!Number.isInteger(groupId) || !item || typeof item !== 'object') {
      continue;
    }

    const switches = target.get(groupId) ?? new Map<GroupAdminCommandKey, boolean>();
    for (const [commandKeyText, enabled] of Object.entries(item)) {
      if (
        groupAdminCommandDefinitions.some((definition) => definition.key === commandKeyText) &&
        typeof enabled === 'boolean'
      ) {
        switches.set(commandKeyText as GroupAdminCommandKey, enabled);
      }
    }

    target.set(groupId, switches);
  }
}

export function commandSwitchMapToRecord(
  value: ReadonlyMap<number, ReadonlyMap<GroupAdminCommandKey, boolean>>,
): Record<string, Record<GroupAdminCommandKey, boolean>> {
  return Object.fromEntries(
    [...value.entries()]
      .sort(([left], [right]) => left - right)
      .map(([groupId, switches]) => [
        groupId,
        Object.fromEntries([...switches.entries()].sort(([left], [right]) => left.localeCompare(right))) as Record<
          GroupAdminCommandKey,
          boolean
        >,
      ]),
  );
}
