import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bumpFor,
  humanDate,
  nextVersion,
  notesFor,
  parseCommit,
  prependToChangelog,
} from "./release.mts";

const at = new Date("2026-08-18T09:00:00Z");
const parse = (...messages: string[]) => messages.map(parseCommit);

test("a conventional subject parses into its parts", () => {
  assert.deepEqual(parseCommit("feat(player): add a queue"), {
    type: "feat",
    scope: "player",
    description: "add a queue",
    breaking: false,
  });
  assert.deepEqual(parseCommit("docs: tidy the readme"), {
    type: "docs",
    scope: null,
    description: "tidy the readme",
    breaking: false,
  });
});

test("anything that is not a conventional commit is ignored, not guessed at", () => {
  for (const message of ["Merge branch 'main'", "wip", ""]) {
    assert.equal(parseCommit(message), null);
  }
});

test("both breaking-change markers are recognised", () => {
  assert.equal(parseCommit("feat!: drop the old store")?.breaking, true);
  assert.equal(parseCommit("feat(api)!: rename a field")?.breaking, true);
  assert.equal(
    parseCommit("refactor: move a module\n\nBREAKING CHANGE: the export moved")?.breaking,
    true,
  );
  assert.equal(parseCommit("feat: a normal feature")?.breaking, false);
});

const quiet = ["docs: fix a typo", "refactor(core): tidy", "test: add a case", "ci: cache"];
const refactorBreak = "refactor: move it\n\nBREAKING CHANGE: import path changed";
const bumps: [string, string[], string, string | null][] = [
  ["silent types alone do not cut a release", quiet, "0.1.0", null],
  ["fix is a patch", ["fix: a bug"], "1.2.3", "patch"],
  ["perf is a patch", ["perf: quicker"], "1.2.3", "patch"],
  ["feat is a minor", ["feat: a thing", "fix: a bug"], "1.2.3", "minor"],
  ["below 1.0.0 a breaking change is a minor", ["feat!: reshape the queue"], "0.1.0", "minor"],
  ["from 1.0.0 a breaking change is a major", ["feat!: reshape the queue"], "1.4.0", "major"],
  ["a breaking change in a silent type still releases", [refactorBreak], "1.0.0", "major"],
  ["a breaking silent type below 1.0.0 is a minor", [refactorBreak], "0.3.0", "minor"],
];
for (const [name, messages, version, expected] of bumps) {
  test(name, () => assert.equal(bumpFor(parse(...messages), version), expected));
}

test("nextVersion resets the parts below the one it moves", () => {
  assert.equal(nextVersion("1.4.7", "major"), "2.0.0");
  assert.equal(nextVersion("1.4.7", "minor"), "1.5.0");
  assert.equal(nextVersion("1.4.7", "patch"), "1.4.8");
  assert.equal(nextVersion("0.1.0", "minor"), "0.2.0");
});

test("nextVersion refuses a version it cannot read", () => {
  assert.throws(() => nextVersion("1.2", "patch"), /not a semver/);
  assert.throws(() => nextVersion("nightly", "patch"), /not a semver/);
});

test("the notes group by kind and name the scope", () => {
  const notes = notesFor(
    parse("feat(explore): fuse two charts", "fix(player): stop skipping", "perf: fewer bytes"),
    "0.2.0",
    at,
  );
  assert.match(notes, /^## 0\.2\.0 — 18 August 2026$/m);
  assert.match(notes, /### Added\n\n- \*\*explore\*\* — fuse two charts/);
  assert.match(notes, /### Fixed\n\n- \*\*player\*\* — stop skipping/);
  assert.match(notes, /### Faster\n\n- fewer bytes/);
});

test("the notes count the quiet work rather than listing it, in the right number", () => {
  const notes = notesFor(parse("feat: a thing", "refactor: tidy", "docs: a note"), "0.2.0", at);
  assert.match(notes, /2 further changes under the hood/);
  assert.doesNotMatch(notes, /tidy/, "a refactor subject should not be listed");
  assert.match(
    notesFor(parse("fix: a bug", "chore: bump"), "0.1.1", at),
    /1 further change under the hood/,
  );
});

test("a breaking entry leads, and is not also listed under its own type", () => {
  const notes = notesFor(parse("feat(api)!: rename a field"), "0.2.0", at);
  assert.match(notes, /### Breaking\n\n- \*\*api\*\* — rename a field/);
  assert.doesNotMatch(notes, /### Added/, "it should not appear twice");
});

test("a release can never have an empty body", () => {
  for (const message of [
    "refactor: move it\n\nBREAKING CHANGE: the export moved",
    "chore!: drop node 20",
    "feat: something ordinary",
    "fix: a bug",
  ]) {
    const commits = parse(message);
    const bump = bumpFor(commits, "0.1.0");
    assert.ok(bump, `${message} should release`);

    const notes = notesFor(commits, nextVersion("0.1.0", bump), at);
    assert.notEqual(notes.slice(notes.indexOf("\n")).trim(), "", `${message} has an empty body`);
  }
});

test("the date comes from the author's offset, not the runner's zone", () => {
  assert.equal(humanDate("2026-08-18T00:44:00+07:00"), "18 August 2026");
  assert.equal(humanDate("2026-08-01T23:59:00+07:00"), "1 August 2026");
  assert.equal(humanDate("2026-08-17T17:44:00Z"), "17 August 2026");
  assert.equal(humanDate("2026-12-31T23:00:00-05:00"), "31 December 2026");
  assert.match(
    notesFor(parse("fix: a bug"), "0.1.2", "2026-08-18T00:44:00+07:00"),
    /^## 0\.1\.2 — 18 August 2026$/m,
  );
});

test("without a timestamp the date is local, for a run on somebody's machine", () => {
  const now = new Date();
  const month = now.toLocaleString("en-GB", { month: "long" });
  assert.equal(humanDate(undefined), `${now.getDate()} ${month} ${now.getFullYear()}`);
  assert.equal(humanDate(new Date("2026-03-09T12:00:00")), "9 March 2026");
});

test("a new section goes above the newest existing release, below the preamble", () => {
  const existing = "# Changelog\n\nSome preamble.\n\n## 0.1.0 — 17 August 2026\n\nThe first release.\n";
  assert.equal(
    prependToChangelog(existing, "## 0.2.0 — 18 August 2026\n\nNew things.\n"),
    "# Changelog\n\nSome preamble.\n\n## 0.2.0 — 18 August 2026\n\nNew things.\n\n" +
      "## 0.1.0 — 17 August 2026\n\nThe first release.\n",
  );
});

test("a changelog with no releases yet gets the first section appended", () => {
  const merged = prependToChangelog("# Changelog\n\nNothing yet.\n", "## 0.1.0\n\nFirst.\n");
  assert.equal(merged, "# Changelog\n\nNothing yet.\n\n## 0.1.0\n\nFirst.\n");
});
