/**
 * Turning wheel events into volume steps.
 *
 * Pure and separate from the control because the arithmetic has two traps that
 * are invisible until the wrong input device is used:
 *
 * 1. **Devices disagree wildly about magnitude.** One notch of a mouse wheel
 *    reports ~100, while a trackpad reports a stream of 1–10 values sixty times
 *    a second. Stepping once per *event* means a mouse moves the volume 5% and
 *    a trackpad slams it from full to silent in a flick. Accumulating distance
 *    and spending it in fixed steps makes both feel the same.
 *
 * 2. **`deltaY` is not always pixels.** `deltaMode` says whether the number
 *    means pixels, lines or pages, and Firefox commonly reports lines. Treating
 *    3 lines as 3 pixels makes the control nearly inert there.
 */

/** How much scrolling buys one step of volume. */
export const WHEEL_THRESHOLD = 50;

const LINE_HEIGHT = 16;
const PAGE_HEIGHT = 400;

/** `deltaY` in pixels, whatever unit the device reported it in. */
export function pixelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT;
  if (deltaMode === 2) return deltaY * PAGE_HEIGHT;
  return deltaY;
}

export interface WheelSteps {
  /** Whole steps to spend now. Positive means scrolled *down*. */
  steps: number;
  /** Distance left over, to carry into the next event. */
  rest: number;
}

/**
 * Splits accumulated scroll into whole steps and a remainder.
 *
 * The remainder is the point: without carrying it, a trackpad's small deltas
 * each round to zero and the control never moves at all.
 *
 * `Math.trunc` rather than `Math.floor` so the two directions behave
 * symmetrically — `floor(-0.5)` is `-1`, which would make scrolling up spend a
 * step it had not yet earned while scrolling down waited its turn.
 */
export function wheelSteps(accumulated: number): WheelSteps {
  // `+ 0` normalises negative zero: `Math.trunc(-0.5)` is `-0`, which is equal
  // to `0` in arithmetic but not under `Object.is` or a strict assertion — a
  // needless surprise to hand a caller.
  const steps = Math.trunc(accumulated / WHEEL_THRESHOLD) + 0;
  return { steps, rest: accumulated - steps * WHEEL_THRESHOLD };
}
