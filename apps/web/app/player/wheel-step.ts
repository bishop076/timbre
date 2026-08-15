/*
 * Wheel events into volume steps. One mouse notch reports ~100 while a trackpad streams 1–10
 * sixty times a second, so stepping per *event* moves 5% on a mouse and full-to-silent on a
 * trackpad — hence distance accumulated and spent in fixed steps. And `deltaY` is not always
 * pixels: `deltaMode` may say lines, as Firefox commonly does.
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
 * Accumulated scroll as whole steps plus a remainder. Uncarried, a trackpad's small deltas
 * each round to zero and nothing moves. `Math.trunc`, not `Math.floor` — `floor(-0.5)` is `-1`.
 */
export function wheelSteps(accumulated: number): WheelSteps {
  // `+ 0` normalises negative zero, which `Object.is` and strict assertions catch.
  const steps = Math.trunc(accumulated / WHEEL_THRESHOLD) + 0;
  return { steps, rest: accumulated - steps * WHEEL_THRESHOLD };
}
