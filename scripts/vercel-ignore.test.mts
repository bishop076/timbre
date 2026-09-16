import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The release commit that carried the work, and was thrown away for carrying a version.
 *
 * `release.yml` pushes `chore(release): <version>` onto main a couple of minutes after the
 * commit it versions, so a version bump is usually what Vercel finds at the tip. The ignore
 * step used to decide on that tip's message alone, and `VERCEL_GIT_PREVIOUS_SHA` only moves
 * on a deployment that succeeded — so whenever the work's own deployment errored, was
 * superseded or was never created, everything since the last live build ended up underneath
 * a bump that was guaranteed to be skipped. On 16 September that left production on
 * `953669c` while main had moved twenty-four commits past it.
 *
 * These tests are about the property that fixes it: skip a version bump, but only when a
 * version bump is all there is since the commit this project last put live. They also pin
 * the half that must not change — a bump must still not drag the other project's build
 * along with it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "vercel-ignore.sh");

/** Git for Windows keeps `sh` out of the system PATH; CI and Vercel both have it. */
const NO_SH = spawnSync("sh", ["-c", "exit 0"]).status === 0 ? false : "no POSIX sh here";

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr}`);
  return run.stdout.trim();
}

function write(dir: string, relative: string, body: string): void {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body);
}

/** A repository shaped like this one: a live build, work on top of it, then the bump. */
function history(): { dir: string; live: string; work: string; bump: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "timbre-ignore-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "gate@example.com");
  git(dir, "config", "user.name", "gate");
  git(dir, "config", "commit.gpgsign", "false");

  const commit = (subject: string): string => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "--no-verify", "-m", subject);
    return git(dir, "rev-parse", "HEAD");
  };

  write(dir, "package.json", `{ "version": "0.1.0" }\n`);
  write(dir, "apps/web/app/page.tsx", "export default () => null;\n");
  write(dir, "apps/ytmusic/app/main.py", "app = None\n");
  const live = commit("chore: the state production is serving");

  write(dir, "apps/web/app/page.tsx", "export default () => <p>now with a fix</p>;\n");
  const work = commit("fix(player): a stall the listener could hear");

  write(dir, "package.json", `{ "version": "0.1.1" }\n`);
  const bump = commit("chore(release): 0.1.1 [skip ci]");

  return { dir, live, work, bump };
}

/** The ignore step as Vercel runs it: exit 0 skips the build, anything else builds. */
function decide(dir: string, project: "web" | "sidecar", env: Record<string, string>) {
  const run = spawnSync("sh", [SCRIPT, project], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { decision: run.status === 0 ? "skip" : "build", said: `${run.stdout}${run.stderr}`.trim() };
}

test("a bump on top of the build that is already live is still skipped", { skip: NO_SH }, () => {
  const { dir, work } = history();
  const { decision, said } = decide(dir, "web", {
    VERCEL_GIT_PREVIOUS_SHA: work,
    VERCEL_GIT_COMMIT_MESSAGE: "chore(release): 0.1.1 [skip ci]",
  });

  assert.equal(decision, "skip", said);
  assert.match(said, /skipping web/);
});

test("a bump with undeployed work under it builds, however the tip reads", { skip: NO_SH }, () => {
  const { dir, live } = history();
  const { decision, said } = decide(dir, "web", {
    VERCEL_GIT_PREVIOUS_SHA: live,
    VERCEL_GIT_COMMIT_MESSAGE: "chore(release): 0.1.1 [skip ci]",
  });

  assert.equal(decision, "build", `the fix under the bump would never have shipped: ${said}`);
});

test("a bump still does not drag the other project's build along", { skip: NO_SH }, () => {
  const { dir, live, work } = history();
  for (const base of [live, work]) {
    const { decision, said } = decide(dir, "sidecar", {
      VERCEL_GIT_PREVIOUS_SHA: base,
      VERCEL_GIT_COMMIT_MESSAGE: "chore(release): 0.1.1 [skip ci]",
    });
    assert.equal(decision, "skip", said);
  }
});

test("with no previous deployment to compare against, it builds", { skip: NO_SH }, () => {
  const { dir } = history();
  const { decision } = decide(dir, "web", { VERCEL_GIT_PREVIOUS_SHA: "" });

  assert.equal(decision, "build");
});

test("a project name it does not know is built, not guessed at", { skip: NO_SH }, () => {
  const { dir, work } = history();
  const run = spawnSync("sh", [SCRIPT, "everything"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: work },
  });

  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Unknown project/);
});
