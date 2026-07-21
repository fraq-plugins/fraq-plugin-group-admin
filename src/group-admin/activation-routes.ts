import { type milky, param, type Router, type Session } from '@fraqjs/fraq';

type ReplySegment = Extract<milky.IncomingSegment, { type: 'reply' }>;
type RouteExecutor<T extends string> = (session: Session, literal: T) => void | Promise<void>;
type ReplyRouteExecutor<T extends string> = (session: Session, reply: ReplySegment, literal: T) => void | Promise<void>;

export function registerLiteralRawRoutes<T extends string>(
  router: Router,
  literals: readonly T[],
  execute: RouteExecutor<T>,
): void {
  for (const literal of literals) {
    router
      .rawPattern()
      .arg('literal', param.literal(literal))
      .execute((session, { literal: capturedLiteral }) => execute(session, capturedLiteral));
  }
}

export function registerReplyLiteralRawRoutes<T extends string>(
  router: Router,
  literals: readonly T[],
  execute: ReplyRouteExecutor<T>,
): void {
  for (const literal of literals) {
    router
      .rawPattern()
      .arg('reply', param.segment('reply'))
      .arg('literal', param.literal(literal))
      .execute((session, { reply, literal: capturedLiteral }) => execute(session, reply, capturedLiteral));
  }
}

export function registerReplyLiteralCatchAllRawRoutes<T extends string>(
  router: Router,
  literals: readonly T[],
  execute: (session: Session, reply: ReplySegment, literal: T, target: milky.IncomingSegment[]) => void | Promise<void>,
): void {
  for (const literal of literals) {
    router
      .rawPattern()
      .arg('reply', param.segment('reply'))
      .arg('literal', param.literal(literal))
      .arg('target', param.catchAll())
      .execute((session, { reply, literal: capturedLiteral, target }) =>
        execute(session, reply, capturedLiteral, target),
      );
  }
}
