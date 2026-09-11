export function rotationBucket(now: number, periodMs: number): number {
  return Math.floor(now / periodMs);
}

export function currentRotation(periodMs: number): number {
  return rotationBucket(Date.now(), periodMs);
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const next = [...items];
  const draw = random(seed);
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(draw() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

export function interleaveBy<T>(lists: readonly T[][], key: (item: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));

  for (let round = 0; round < longest && out.length < limit; round += 1) {
    for (const list of lists) {
      const item = list[round];
      if (item === undefined) continue;
      const id = key(item);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(item);
      if (out.length === limit) break;
    }
  }

  return out;
}
