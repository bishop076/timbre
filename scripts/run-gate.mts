#!/usr/bin/env node

/**
 * Runs every half of a gate, then fails if any half failed.
 *
 * `"typecheck": "pnpm -r typecheck && tsc -p scripts"` looked like one gate and was two, joined
 * by an operator whose entire job is to skip the second when the first is red. It hid a broken
 * call in `scripts/spotify-canary.mts` for three weeks: `apps/web` was independently failing, so
 * `tsc -p scripts` never ran once in 24 consecutive CI runs, and not one of their logs mentions
 * the script at all. A gate that stops at the first bad news can only ever tell you about one
 * thing, and it is never the thing you did not already know about.
 *
 * So: run every half, say how each one went, and exit non-zero if any of them failed. That last
 * part is what keeps this from being worse than the `&&` it replaces — a gate that prints two
 * failures and returns 0 is a gate that has stopped being one.
 *
 * Each half stays a script of its own, which is also what makes `pnpm typecheck:scripts` a thing
 * a person can run on its own when that is the half they are fixing.
 *
 * Why not a `;`-joined pair: package scripts run under cmd.exe on Windows, where `;` separates
 * nothing. `tsc -p scripts` and the `;` in front of it arrive as arguments to the first command,
 * the second half never runs, and the whole thing exits 0 — the same masking as `&&`, now silent.
 * Why not two CI steps: CI is not where the three weeks were lost. `pnpm typecheck` is step one
 * of this project's own checklist, and splitting it only in the workflow leaves every local run
 * masking precisely what it masked before.
 *
 * `node --run` rather than `pnpm run` for the halves: it reads the same `scripts` block and puts
 * the same `node_modules/.bin` on PATH, and it starts in about 0.4s against pnpm's 2.2s. Paying
 * that twice would have made an honest gate a slower one, which is the trade nobody asked for.
 */

import { spawnSync } from "node:child_process";

const halves = process.argv.slice(2);
if (halves.length < 2) {
  console.error("usage: run-gate.mts <script> <script> [...]");
  process.exit(2);
}

const failed: string[] = [];

for (const half of halves) {
  console.log(`\n> ${half}`);
  const { status, error } = spawnSync(process.execPath, ["--run", half], { stdio: "inherit" });
  if (error) console.error(`could not start ${half}: ${error.message}`);
  if (error || status !== 0) failed.push(half);
}

const verdict = halves.map((half) => `${failed.includes(half) ? "FAILED" : "ok"} ${half}`);
console.log(`\n[gate] ${verdict.join("   ")}`);

if (failed.length > 0) {
  console.error(`[gate] ${failed.length} of ${halves.length} halves failed: ${failed.join(", ")}`);
  process.exit(1);
}
