// What makes Explore move between visits without anything being stored: a slice of the clock
// picks which part of a larger pool is shown. Deliberately without `server-only` — the
// stations row reorders on the client from a seed the server rendered with, and the two must
// agree or hydration shows one order and then another.

/** Which period of `periodMs` the clock is in — the same number for everyone inside it. */
export function rotationBucket(now: number, periodMs: number): number {
  return Math.floor(now / periodMs);
}

/**
 * The bucket the clock is in right now, for a server render to seed from. A statically
 * rendered page runs once per revalidation, so reading the clock there is the point, not an
 * accident — it is what makes each rebuild different from the last.
 */
export function currentRotation(periodMs: number): number {
  return rotationBucket(Date.now(), periodMs);
}

/** Mulberry32: tiny, fast, and the same sequence for the same seed on server and browser. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Fisher–Yates on a copy, driven by `seed` rather than `Math.random`, so a render can do it. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const next = [...items];
  const draw = random(seed);
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(draw() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

/**
 * One from each list in turn, skipping anything already taken, until `limit` or every list
 * is spent. Round-robin rather than concatenation: three stations joined end to end play the
 * whole of the first before the second is heard.
 */
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
