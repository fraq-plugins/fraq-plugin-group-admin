import type { milky } from '@fraqjs/fraq';

export function parseModerationTarget(segments: milky.IncomingSegment[]): number | undefined {
  const mention = segments.find((segment) => segment.type === 'mention');
  if (mention) {
    return mention.data.user_id;
  }

  const match = segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.data.text)
    .join(' ')
    .match(/\d+/u);
  return match ? Number(match[0]) : undefined;
}

export function parseModerationDuration(segments: milky.IncomingSegment[], targetUserId: number): number | undefined {
  const numbers = segments
    .filter((segment) => segment.type === 'text')
    .flatMap((segment) => segment.data.text.match(/\d+/gu) ?? [])
    .map(Number);
  const firstNonTargetNumber = numbers.find((number) => number !== targetUserId);
  return firstNonTargetNumber && firstNonTargetNumber > 0 ? firstNonTargetNumber : undefined;
}

export function canBotModerateTarget(
  botRole: 'owner' | 'admin' | 'member',
  targetRole: 'owner' | 'admin' | 'member',
): boolean {
  if (botRole === 'owner') {
    return targetRole !== 'owner';
  }

  if (botRole === 'admin') {
    return targetRole === 'member';
  }

  return false;
}

export function parseTextNumbers(segments: milky.IncomingSegment[]): number[] {
  return segments
    .filter((segment) => segment.type === 'text')
    .flatMap((segment) => segment.data.text.match(/\d+/gu) ?? [])
    .map(Number);
}

export function getMessagePlainText(segments: milky.IncomingSegment[]): string {
  return segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.data.text)
    .join('');
}

export function parseRecallTarget(segments: milky.IncomingSegment[]): number | undefined {
  const mention = segments.find((segment) => segment.type === 'mention');
  if (mention) {
    return mention.data.user_id;
  }

  const numbers = parseTextNumbers(segments);
  return numbers.length > 1 ? numbers[0] : undefined;
}

export function parseRecallCount(segments: milky.IncomingSegment[]): number | undefined {
  const hasMentionTarget = segments.some((segment) => segment.type === 'mention');
  const numbers = parseTextNumbers(segments);
  const count = hasMentionTarget || numbers.length === 1 ? numbers[0] : numbers[1];
  return count && count > 0 ? count : undefined;
}

export function parseReplySegment(
  segments: milky.IncomingSegment[],
): Extract<milky.IncomingSegment, { type: 'reply' }> | undefined {
  return segments.find((segment) => segment.type === 'reply') as
    | Extract<milky.IncomingSegment, { type: 'reply' }>
    | undefined;
}

export function uniqueMessages(messages: milky.IncomingMessage[]): milky.IncomingMessage[] {
  const seenMessageSeqs = new Set<number>();
  return messages.filter((message) => {
    if (seenMessageSeqs.has(message.message_seq)) {
      return false;
    }

    seenMessageSeqs.add(message.message_seq);
    return true;
  });
}

export function sortMessagesNewestFirst(messages: milky.IncomingMessage[]): milky.IncomingMessage[] {
  return [...messages].sort((a, b) => b.message_seq - a.message_seq);
}

export function selectRecallMessages(
  messages: milky.IncomingMessage[],
  anchorMessageSeq: number,
  includeAnchor: boolean,
  targetUserId: number | undefined,
  protectedUserIds?: ReadonlySet<number>,
): milky.IncomingMessage[] {
  return sortMessagesNewestFirst(
    uniqueMessages(messages).filter((message) => {
      if (message.message_scene !== 'group') {
        return false;
      }

      if (includeAnchor ? message.message_seq > anchorMessageSeq : message.message_seq >= anchorMessageSeq) {
        return false;
      }

      if (protectedUserIds?.has(message.sender_id)) {
        return false;
      }

      return targetUserId ? message.sender_id === targetUserId : true;
    }),
  );
}
