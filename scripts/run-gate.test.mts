import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The gate that could hide half of itself.
 *
 * `pnpm -r typecheck && tsc -p scripts` skipped the second half whenever the first was red,
 * which is how a `scripts/spotify-canary.mts` that had not compiled since `165f0fe` survived 24
 * consecutive CI runs without being named once. These tests are about the property that fixes
 * it — every half runs, every result is reported, and the gate still fails — and about the
 * `scripts` block in `package.json` keeping that shape.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN_GATE = path.join(HERE, "run-gate.mts");
const ROOT = path.dirname(HERE);

/** A throwaway package whose scripts pass or fail exactly as asked, then the gate over them. */
function gate(halves: Record<string, boolean>) {
  const dir = mkdtempSync(path.join(tmpdir(), "timbre-gate-"));
  const scripts = Object.fromEntries(
    Object.entries(halves).map(([name, passes]) => [
      name,
      `node -e "console.log('ran ${name}');process.exit(${passes ? 0 : 1})"`,
    ]),
  );
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "gate-probe", scripts }));

  const run = spawnSync(process.execPath, [RUN_GATE, ...Object.keys(halves)], {
    cwd: dir,
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("a failing first half does not stop the second from running", () => {
  const { status, output } = gate({ first: false, second: true });

  assert.match(output, /ran first/);
  assert.match(output, /ran second/, "the second half never ran — this is the bug itself");
  assert.equal(status, 1);
});

test("the verdict names which half failed, and which did not", () => {
  const { output } = gate({ first: false, second: true });

  assert.match(output, /FAILED first/);
  assert.match(output, /ok second/);
});

test("both halves failing is still one non-zero exit, and both are named", () => {
  const { status, output } = gate({ first: false, second: false });

  assert.equal(status, 1);
  assert.match(output, /FAILED first/);
  assert.match(output, /FAILED second/);
});

test("a gate whose halves all pass exits zero", () => {
  const { status, output } = gate({ first: true, second: true });

  assert.equal(status, 0);
  assert.match(output, /ok first/);
  assert.match(output, /ok second/);
});

test("every root gate runs its halves rather than chaining them with &&", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  for (const gateName of ["typecheck", "typecheck:fast", "test"]) {
    const command = scripts[gateName];
    assert.ok(command, `${gateName} is missing from the root scripts`);
    assert.doesNotMatch(
      command,
      /&&/,
      `${gateName} chains its halves with && — one of them can hide the other`,
    );

    const halves = command.replace("node scripts/run-gate.mts ", "").split(" ");
    assert.ok(halves.length >= 2, `${gateName} does not run two halves`);
    for (const half of halves) {
      assert.ok(scripts[half], `${gateName} names a half "${half}" that is not a script`);
    }
  }
});

test("the workspace half of each gate does not bail on the first failing package", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  // `pnpm -r` stops at the first package that fails, so packages/core being red hid apps/web
  // the same way the `&&` hid the scripts. `--parallel` runs them all regardless; anything
  // sequential has to say --no-bail.
  for (const half of ["typecheck:packages", "typecheck:fast:packages", "test:packages"]) {
    const command = scripts[half] ?? "";
    assert.match(
      command,
      /--no-bail|--parallel/,
      `${half} bails on the first failing package, which hides the rest`,
    );
  }
});
