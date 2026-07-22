import { Context, type milky, type RouteDescriptor, Router, type Session } from '@fraqjs/fraq';

import GroupAdminPlugin, { SchedulerPlugin, SchedulerService } from '../src';
import { registerLiteralRawRoutes, registerReplyLiteralRawRoutes } from '../src/group-admin/activation-routes';
import type { GroupAdminApi } from '../src/group-admin/api';
import { normalizeGroupAdminConfig } from '../src/group-admin/config';
import { createGroupAdminDataStore } from '../src/group-admin/data-store';
import type { GroupAdminDataStore, GroupAdminRuntime } from '../src/group-admin/models';
import { registerScheduledTasks } from '../src/group-admin/scheduled-tasks';
import { createGroupScope } from '../src/group-admin/scope';

import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!GroupAdminPlugin || !SchedulerPlugin || !SchedulerService) {
  throw new Error('Plugin exports are not loadable.');
}

const incomingMessage = (...segments: milky.IncomingSegment[]) => ({ segments }) as milky.IncomingMessage;
const text = (value: string) => ({ type: 'text', data: { text: value } }) as milky.IncomingSegment;
const reply = {
  type: 'reply',
  data: { message_seq: 1, sender_id: 20_000, time: 0, segments: [] },
} as milky.IncomingSegment;
const groupSession = (groupId = 12_345) =>
  ({
    selfId: 10_000,
    raw: {
      message_scene: 'group',
      peer_id: groupId,
      sender_id: 20_000,
      group_member: { role: 'admin' },
    },
  }) as Session;

function createClient(): Parameters<typeof Context.fromClient>[0] {
  return {
    callApi: async (endpoint: string) => {
      throw new Error(`Unexpected Milky API call: ${endpoint}`);
    },
  } as unknown as Parameters<typeof Context.fromClient>[0];
}

async function testCliDefaultExportStartup(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'fraq-group-admin-cli-'));
  const ctx = Context.fromClient(createClient());
  try {
    // This is intentionally equivalent to the Fraq CLI generated install line: only .default is installed.
    ctx.install(GroupAdminPlugin, { dataPath: join(directory, 'data.json') });
    await ctx.start();
    await ctx.stop();
  } finally {
    await ctx.stop().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

function testActivationRoutes(): void {
  const router = new Router().setActivationResolver(() => [{ type: 'prefix', prefix: '/' }]);
  registerLiteralRawRoutes(router, ['recall'], () => undefined, ['group-admin:recall']);
  registerReplyLiteralRawRoutes(router, ['y'], () => undefined, ['group-admin:join-review']);

  const session = groupSession();
  assert.equal(router.match(session, incomingMessage(text('recall'))), undefined);
  assert.equal(router.match(session, incomingMessage(text('/recall')))?.type, 'rawPattern');
  assert.equal(router.match(session, incomingMessage(reply, text('y'))), undefined);
  assert.equal(router.match(session, incomingMessage(reply, text('/y')))?.type, 'rawPattern');

  const mentionRouter = new Router().setActivationResolver(() => [{ type: 'mention', prefix: '/' }]);
  registerReplyLiteralRawRoutes(mentionRouter, ['y'], () => undefined);
  const mention = { type: 'mention', data: { user_id: session.selfId } } as milky.IncomingSegment;
  assert.equal(mentionRouter.match(session, incomingMessage(reply, text('/y'))), undefined);
  assert.equal(mentionRouter.match(session, incomingMessage(reply, mention, text('/y')))?.type, 'rawPattern');
}

async function testPluginTagsAndScope(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'fraq-group-admin-routes-'));
  const activationResolver = (route: RouteDescriptor) =>
    route.meta?.tags?.includes('group-admin:recall')
      ? [{ type: 'direct' } as const]
      : [{ type: 'prefix', prefix: '/' } as const];
  const ctx = Context.fromClient(createClient(), { routing: { activationResolver } });
  try {
    ctx.install(GroupAdminPlugin, { groupIds: [12_345], dataPath: join(directory, 'data.json') });
    await ctx.start();

    assert.equal(ctx.router.match(groupSession(), incomingMessage(text('help'))), undefined);
    assert.equal(ctx.router.match(groupSession(), incomingMessage(text('/help')))?.type, 'command');
    assert.equal(ctx.router.match(groupSession(), incomingMessage(text('recall')))?.type, 'rawPattern');
    assert.equal(ctx.router.match(groupSession(99_999), incomingMessage(text('/help'))), undefined);
  } finally {
    await ctx.stop().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

function testRuntimeConfigValidation(): void {
  assert.throws(() => normalizeGroupAdminConfig({ reviewerUserIds: '10000' }), /reviewerUserIds/u);
  assert.throws(() => normalizeGroupAdminConfig({ inactiveCleanupCron: 'invalid' }), /inactiveCleanupCron/u);
  assert.throws(() => normalizeGroupAdminConfig({ groupMemberCardPattern: '[' }), /groupMemberCardPattern/u);
  assert.deepEqual(normalizeGroupAdminConfig(undefined).groupIds, []);
}

function testScope(): void {
  const scope = createGroupScope([1, 2]);
  assert.equal(scope.includes(1), true);
  assert.equal(scope.includes(3), false);
}

async function testScheduledTaskScope(): Promise<void> {
  const callbacks: Array<() => void | Promise<void>> = [];
  const requestedGroupIds: number[] = [];
  const scheduler = {
    expression: (_cron: string, callback: () => void | Promise<void>) => {
      callbacks.push(callback);
      return undefined;
    },
  } as unknown as SchedulerService;
  const store: GroupAdminDataStore = {
    blacklistedUserIds: new Set(),
    whitelistedUserIds: new Set(),
    forbiddenWords: new Set(),
    groupSwitches: new Map(),
    commandSwitches: new Map(),
    commandFeatureSwitches: new Map(),
    silentSwitches: new Map(),
    memberCardSnapshots: new Map(),
    ready: Promise.resolve(),
    save: async () => undefined,
  };
  const logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const config = normalizeGroupAdminConfig({
    groupIds: [1],
    inactiveCleanupEnabled: true,
    inactiveCleanupFreeSlotsThreshold: 9,
  });
  const runtime = {
    ctx: { logger } as unknown as Context,
    scheduler,
    config,
    store,
    pendingJoinRequests: new Map(),
    spamRecords: new Map(),
    isGroupInScope: (groupId: number) => groupId === 1,
    isGroupEnabled: (groupId: number) => groupId === 1,
    areCommandsEnabled: () => true,
    isCommandFeatureEnabled: () => true,
  } satisfies GroupAdminRuntime;
  const api = {
    get_group_list: async () => ({
      groups: [
        { group_id: 1, member_count: 100, max_member_count: 100 },
        { group_id: 2, member_count: 100, max_member_count: 100 },
      ],
    }),
    get_group_member_list: async ({ group_id }: { group_id: number }) => {
      requestedGroupIds.push(group_id);
      return { members: [] };
    },
  } as unknown as GroupAdminApi;

  registerScheduledTasks({
    runtime,
    api,
    groupMemberCardManagement: { enabled: false },
    kickBlacklistedMember: async () => false,
  });
  assert.equal(callbacks.length, 1);
  await callbacks[0]?.();
  assert.deepEqual(requestedGroupIds, [1]);
}

async function testSerializedAtomicPersistence(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'fraq-group-admin-store-'));
  const dataPath = join(directory, 'data.json');
  const logger = { warn: () => undefined, error: () => undefined } as never;
  try {
    const store = createGroupAdminDataStore({ logger }, { listDataPath: dataPath });
    await store.ready;

    const writes: Promise<void>[] = [];
    for (let userId = 1; userId <= 20; userId += 1) {
      store.blacklistedUserIds.add(userId);
      writes.push(store.save());
    }
    await Promise.all(writes);

    const data = JSON.parse(await readFile(dataPath, 'utf8')) as { blacklistUserIds: number[] };
    assert.deepEqual(
      data.blacklistUserIds,
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    assert.deepEqual(
      (await readdir(directory)).filter((name) => name.endsWith('.tmp')),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

await testCliDefaultExportStartup();
testActivationRoutes();
await testPluginTagsAndScope();
testRuntimeConfigValidation();
testScope();
await testScheduledTaskScope();
await testSerializedAtomicPersistence();
