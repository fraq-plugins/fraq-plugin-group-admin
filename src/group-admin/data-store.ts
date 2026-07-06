import type { Context } from '@fraqjs/fraq';

import {
  addCommandSwitchRecordToMap,
  commandSwitchMapToRecord,
  type GroupAdminCommandKey,
} from './command-definitions';
import { addBooleanRecordToMap, addIntegerArrayToSet, addStringArrayToSet, booleanMapToRecord } from './storage-utils';

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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

function addMemberCardSnapshotRecord(value: unknown, target: Map<number, Map<number, string>>): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [groupIdText, item] of Object.entries(value)) {
    const groupId = Number(groupIdText);
    if (!Number.isInteger(groupId) || !item || typeof item !== 'object') {
      continue;
    }

    const groupCards = target.get(groupId) ?? new Map<number, string>();
    for (const [userIdText, card] of Object.entries(item)) {
      const userId = Number(userIdText);
      if (Number.isInteger(userId) && typeof card === 'string') {
        groupCards.set(userId, card);
      }
    }

    target.set(groupId, groupCards);
  }
}

function memberCardSnapshotMapToRecord(
  value: ReadonlyMap<number, ReadonlyMap<number, string>>,
): Record<string, Record<string, string>> {
  return Object.fromEntries(
    [...value.entries()]
      .sort(([left], [right]) => left - right)
      .map(([groupId, groupCards]) => [
        groupId,
        Object.fromEntries([...groupCards.entries()].sort(([left], [right]) => left - right)),
      ]),
  );
}

export function createGroupAdminDataStore(
  ctx: Pick<Context, 'logger'>,
  options: {
    listDataPath: string;
    blacklistUserIds?: number[];
    whitelistUserIds?: number[];
    forbiddenWords?: string[];
  },
): GroupAdminDataStore {
  const blacklistedUserIds = new Set(options.blacklistUserIds ?? []);
  const whitelistedUserIds = new Set(options.whitelistUserIds ?? []);
  const forbiddenWords = new Set(options.forbiddenWords?.map((word) => word.trim()).filter(Boolean) ?? []);
  const groupSwitches = new Map<number, boolean>();
  const commandSwitches = new Map<number, boolean>();
  const commandFeatureSwitches = new Map<number, Map<GroupAdminCommandKey, boolean>>();
  const silentSwitches = new Map<number, boolean>();
  const memberCardSnapshots = new Map<number, Map<number, string>>();

  const save = async () => {
    await mkdir(dirname(options.listDataPath), { recursive: true });
    await writeFile(
      options.listDataPath,
      `${JSON.stringify(
        {
          blacklistUserIds: [...blacklistedUserIds].sort((a, b) => a - b),
          whitelistUserIds: [...whitelistedUserIds].sort((a, b) => a - b),
          forbiddenWords: [...forbiddenWords].sort((a, b) => a.localeCompare(b)),
          groupSwitches: booleanMapToRecord(groupSwitches),
          commandSwitches: booleanMapToRecord(commandSwitches),
          commandFeatureSwitches: commandSwitchMapToRecord(commandFeatureSwitches),
          silentSwitches: booleanMapToRecord(silentSwitches),
          memberCardSnapshots: memberCardSnapshotMapToRecord(memberCardSnapshots),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  };

  const ready = (async () => {
    try {
      const content = await readFile(options.listDataPath, 'utf8');
      const data: unknown = JSON.parse(content);
      if (!data || typeof data !== 'object') {
        ctx.logger.warn(`名单数据格式无效：${options.listDataPath}`);
        await save();
        return;
      }

      addIntegerArrayToSet('blacklistUserIds' in data ? data.blacklistUserIds : undefined, blacklistedUserIds);
      addIntegerArrayToSet('whitelistUserIds' in data ? data.whitelistUserIds : undefined, whitelistedUserIds);
      addStringArrayToSet('forbiddenWords' in data ? data.forbiddenWords : undefined, forbiddenWords);
      addBooleanRecordToMap('groupSwitches' in data ? data.groupSwitches : undefined, groupSwitches);
      addBooleanRecordToMap('commandSwitches' in data ? data.commandSwitches : undefined, commandSwitches);
      addCommandSwitchRecordToMap(
        'commandFeatureSwitches' in data ? data.commandFeatureSwitches : undefined,
        commandFeatureSwitches,
      );
      addBooleanRecordToMap('silentSwitches' in data ? data.silentSwitches : undefined, silentSwitches);
      addMemberCardSnapshotRecord(
        'memberCardSnapshots' in data ? data.memberCardSnapshots : undefined,
        memberCardSnapshots,
      );
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
        ctx.logger.error(`读取名单数据失败：${options.listDataPath}`, error);
      }
    }

    await save();
  })();

  return {
    blacklistedUserIds,
    whitelistedUserIds,
    forbiddenWords,
    groupSwitches,
    commandSwitches,
    commandFeatureSwitches,
    silentSwitches,
    memberCardSnapshots,
    ready,
    save,
  };
}
