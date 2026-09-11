export const WHEEL_THRESHOLD = 50;

const LINE_HEIGHT = 16;
const PAGE_HEIGHT = 400;

export function pixelDelta(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT;
  if (deltaMode === 2) return deltaY * PAGE_HEIGHT;
  return deltaY;
}

export interface WheelSteps {
  steps: number;
  rest: number;
}

export function wheelSteps(accumulated: number): WheelSteps {
  const steps = Math.trunc(accumulated / WHEEL_THRESHOLD) + 0;
  return { steps, rest: accumulated - steps * WHEEL_THRESHOLD };
}
