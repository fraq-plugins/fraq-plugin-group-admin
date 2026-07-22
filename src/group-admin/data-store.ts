import type { Context } from '@fraqjs/fraq';

import {
  addCommandSwitchRecordToMap,
  commandSwitchMapToRecord,
  type GroupAdminCommandKey,
} from './command-definitions';
import {
  addBooleanRecordToMap,
  addIntegerArrayToSet,
  addStringArrayToSet,
  booleanMapToRecord,
} from './data-processing';
import type { GroupAdminDataStore } from './models';

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const storesByPath = new Map<string, GroupAdminDataStore>();
let temporaryFileSequence = 0;

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
  const dataPath = resolve(options.listDataPath);
  const existingStore = storesByPath.get(dataPath);
  if (existingStore) {
    addIntegerArrayToSet(options.blacklistUserIds, existingStore.blacklistedUserIds);
    addIntegerArrayToSet(options.whitelistUserIds, existingStore.whitelistedUserIds);
    addStringArrayToSet(options.forbiddenWords, existingStore.forbiddenWords);
    return existingStore;
  }

  const blacklistedUserIds = new Set(options.blacklistUserIds ?? []);
  const whitelistedUserIds = new Set(options.whitelistUserIds ?? []);
  const forbiddenWords = new Set(options.forbiddenWords?.map((word) => word.trim()).filter(Boolean) ?? []);
  const groupSwitches = new Map<number, boolean>();
  const commandSwitches = new Map<number, boolean>();
  const commandFeatureSwitches = new Map<number, Map<GroupAdminCommandKey, boolean>>();
  const silentSwitches = new Map<number, boolean>();
  const memberCardSnapshots = new Map<number, Map<number, string>>();

  let saveQueue = Promise.resolve();
  const save = () => {
    const content = `${JSON.stringify(
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
    )}\n`;
    const write = saveQueue.then(async () => {
      await mkdir(dirname(dataPath), { recursive: true });
      const temporaryPath = `${dataPath}.${process.pid}.${temporaryFileSequence++}.tmp`;
      try {
        await writeFile(temporaryPath, content, 'utf8');
        await rename(temporaryPath, dataPath);
      } catch (error) {
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    });
    saveQueue = write.catch(() => undefined);
    return write;
  };

  const ready = (async () => {
    try {
      const content = await readFile(dataPath, 'utf8');
      const data: unknown = JSON.parse(content);
      if (!data || typeof data !== 'object') {
        ctx.logger.warn(`名单数据格式无效：${dataPath}`);
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
        ctx.logger.error(`读取名单数据失败：${dataPath}`, error);
      }
    }

    await save();
  })();

  const store: GroupAdminDataStore = {
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
  storesByPath.set(dataPath, store);
  return store;
}
