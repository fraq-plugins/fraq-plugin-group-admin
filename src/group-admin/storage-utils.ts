export function addIntegerArrayToSet(value: unknown, target: Set<number>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (Number.isInteger(item)) {
      target.add(item);
    }
  }
}

export function addStringArrayToSet(value: unknown, target: Set<string>): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      target.add(item.trim());
    }
  }
}

export function addBooleanRecordToMap(value: unknown, target: Map<number, boolean>): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const groupId = Number(key);
    if (Number.isInteger(groupId) && typeof item === 'boolean') {
      target.set(groupId, item);
    }
  }
}

export function booleanMapToRecord(value: ReadonlyMap<number, boolean>): Record<string, boolean> {
  return Object.fromEntries([...value.entries()].sort(([left], [right]) => left - right));
}
