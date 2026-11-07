/**
 * Whether a value holds a text anywhere: itself, or any string it reaches through its objects and arrays,
 * each object read once so that a cycle ends.
 *
 * @param value - The receipt, or any part of it.
 * @param needle - The text to look for.
 * @returns True when it is there.
 */
export function mentions(value: unknown, needle: string): boolean {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const next = stack.pop();
    if (typeof next === 'string') {
      if (next.includes(needle)) return true;
      continue;
    }
    if (next === null || typeof next !== 'object') continue;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const child of Object.values(next)) stack.push(child);
  }
  return false;
}
