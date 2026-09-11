const UNSTARTED = -1;
const BUFFERING = 3;

export function stalledAt(state: number, loadedFraction: number, position: number): boolean {
  return (state === UNSTARTED || state === BUFFERING) && loadedFraction <= 0 && position <= 0;
}
