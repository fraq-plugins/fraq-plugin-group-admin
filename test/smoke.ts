import { type milky, Router, type Session } from '@fraqjs/fraq';

import GroupAdminPlugin, { SchedulerPlugin, SchedulerService } from '../src';
import { registerLiteralRawRoutes, registerReplyLiteralRawRoutes } from '../src/group-admin/activation-routes';

import assert from 'node:assert/strict';

if (!GroupAdminPlugin || !SchedulerPlugin || !SchedulerService) {
  throw new Error('Plugin exports are not loadable.');
}

const router = new Router().setActivationResolver(() => [{ type: 'prefix', prefix: '/' }]);
registerLiteralRawRoutes(router, ['recall'], () => undefined);
registerReplyLiteralRawRoutes(router, ['y'], () => undefined);

const session = { selfId: 10000 } as Session;
const incomingMessage = (...segments: milky.IncomingSegment[]) => ({ segments }) as milky.IncomingMessage;
const text = (value: string) => ({ type: 'text', data: { text: value } }) as milky.IncomingSegment;
const reply = {
  type: 'reply',
  data: { message_seq: 1, sender_id: 20000, time: 0, segments: [] },
} as milky.IncomingSegment;

assert.equal(router.match(session, incomingMessage(text('recall'))), undefined);
assert.equal(router.match(session, incomingMessage(text('/recall')))?.type, 'rawPattern');
assert.equal(router.match(session, incomingMessage(reply, text('y'))), undefined);
assert.equal(router.match(session, incomingMessage(reply, text('/y')))?.type, 'rawPattern');

const mentionRouter = new Router().setActivationResolver(() => [{ type: 'mention', prefix: '/' }]);
registerReplyLiteralRawRoutes(mentionRouter, ['y'], () => undefined);
const mention = { type: 'mention', data: { user_id: session.selfId } } as milky.IncomingSegment;

assert.equal(mentionRouter.match(session, incomingMessage(reply, text('/y'))), undefined);
assert.equal(mentionRouter.match(session, incomingMessage(reply, mention, text('/y')))?.type, 'rawPattern');
