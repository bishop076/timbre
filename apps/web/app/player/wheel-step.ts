export const WHEEL_THRESHOLD = 50;

const LINE_HEIGHT = 16;
const PAGE_HEIGHT = 400;

/**
 * The most one wheel event is allowed to be worth: a mouse notch, and no more.
 *
 * `deltaMode` 2 reports whole pages, so a single such event arrived as 400px — eight steps,
 * 40% of the volume, off one flick of the wheel, where the same flick on a mouse reporting
 * pixels moves 10%. The surplus is dropped rather than carried, because an event that big is
 * a page scroll passing over the control, not eight notches the listener owes anyone.
 */
const MAX_EVENT_PIXELS = 100;

export function pixelDelta(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT : deltaMode === 2 ? deltaY * PAGE_HEIGHT : deltaY;
  if (!Number.isFinite(pixels)) return 0;
  return Math.max(-MAX_EVENT_PIXELS, Math.min(MAX_EVENT_PIXELS, pixels));
}

export function wheelSteps(accumulated: number): { steps: number; rest: number } {
  const steps = Math.trunc(accumulated / WHEEL_THRESHOLD) + 0;
  return { steps, rest: accumulated - steps * WHEEL_THRESHOLD };
}
