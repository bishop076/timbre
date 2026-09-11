const UNSTARTED = -1;
const BUFFERING = 3;

export function stalledAt(state: number, loadedFraction: number, position: number): boolean {
  if (state !== UNSTARTED && state !== BUFFERING) return false;
  return loadedFraction <= 0 && position <= 0;
}
