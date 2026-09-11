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
  assert.equal(parseCommit("Merge branch 'main'"), null);
  assert.equal(parseCommit("wip"), null);
  assert.equal(parseCommit(""), null);
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

test("silent types alone do not cut a release", () => {
  const quiet = parse("docs: fix a typo", "refactor(core): tidy", "test: add a case", "ci: cache");
  assert.equal(bumpFor(quiet, "0.1.0"), null);
});

test("feat is a minor, fix and perf are patches", () => {
  assert.equal(bumpFor(parse("fix: a bug"), "1.2.3"), "patch");
  assert.equal(bumpFor(parse("perf: quicker"), "1.2.3"), "patch");
  assert.equal(bumpFor(parse("feat: a thing", "fix: a bug"), "1.2.3"), "minor");
});

test("below 1.0.0 a breaking change is a minor, not a major", () => {
  assert.equal(bumpFor(parse("feat!: reshape the queue"), "0.1.0"), "minor");
  assert.equal(bumpFor(parse("feat!: reshape the queue"), "1.4.0"), "major");
});

test("a breaking change in an otherwise silent type still releases", () => {
  const commits = parse("refactor: move it\n\nBREAKING CHANGE: import path changed");
  assert.equal(bumpFor(commits, "1.0.0"), "major");
  assert.equal(bumpFor(commits, "0.3.0"), "minor");
});

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

test("the notes count the quiet work rather than listing it", () => {
  const notes = notesFor(parse("feat: a thing", "refactor: tidy", "docs: a note"), "0.2.0", at);
  assert.match(notes, /2 further changes under the hood/);
  assert.doesNotMatch(notes, /tidy/, "a refactor subject should not be listed");
});

test("one quiet change is singular", () => {
  const notes = notesFor(parse("fix: a bug", "chore: bump"), "0.1.1", at);
  assert.match(notes, /1 further change under the hood/);
});

test("a breaking entry leads, and is not also listed under its own type", () => {
  const notes = notesFor(parse("feat(api)!: rename a field"), "0.2.0", at);
  assert.match(notes, /### Breaking/);
  assert.match(notes, /- \*\*api\*\* — rename a field/);
  assert.ok(
    notes.indexOf("### Breaking") < notes.indexOf("rename a field"),
    "the entry belongs under the Breaking heading",
  );
  assert.doesNotMatch(notes, /### Added/, "it should not appear twice");
});

test("a release can never have an empty body", () => {
  const NEWLINE = String.fromCharCode(10);
  for (const message of [
    ["refactor: move it", "", "BREAKING CHANGE: the export moved"].join(NEWLINE),
    "chore!: drop node 20",
    "feat: something ordinary",
    "fix: a bug",
  ]) {
    const subject = message.split(NEWLINE)[0];
    const commits = parse(message);
    const bump = bumpFor(commits, "0.1.0");
    assert.ok(bump, `${subject} should release`);

    const body = notesFor(commits, nextVersion("0.1.0", bump), at)
      .split(NEWLINE)
      .slice(1)
      .join(NEWLINE)
      .trim();
    assert.notEqual(body, "", `${subject} released with an empty body`);
  }
});

test("the date comes from the author's offset, not the runner's zone", () => {
  assert.equal(humanDate("2026-08-18T00:44:00+07:00"), "18 August 2026");
  assert.equal(humanDate("2026-08-01T23:59:00+07:00"), "1 August 2026");
  assert.equal(humanDate("2026-08-17T17:44:00Z"), "17 August 2026");
  assert.equal(humanDate("2026-12-31T23:00:00-05:00"), "31 December 2026");
});

test("without a timestamp the date is local, for a run on somebody's machine", () => {
  const now = new Date();
  const expected = `${now.getDate()} ${
    ["January","February","March","April","May","June","July","August","September","October","November","December"][now.getMonth()]
  } ${now.getFullYear()}`;
  assert.equal(humanDate(undefined), expected);
  assert.equal(humanDate(new Date("2026-03-09T12:00:00")), "9 March 2026");
});

test("notesFor accepts the raw ISO string the workflow passes", () => {
  const notes = notesFor(parse("fix: a bug"), "0.1.2", "2026-08-18T00:44:00+07:00");
  assert.match(notes, /^## 0\.1\.2 — 18 August 2026$/m);
});

test("a new section goes above the newest existing release, below the preamble", () => {
  const existing = "# Changelog\n\nSome preamble.\n\n## 0.1.0 — 17 August 2026\n\nThe first release.\n";
  const merged = prependToChangelog(existing, "## 0.2.0 — 18 August 2026\n\nNew things.\n");

  assert.ok(merged.startsWith("# Changelog\n\nSome preamble."), "the preamble stays on top");
  assert.ok(
    merged.indexOf("## 0.2.0") < merged.indexOf("## 0.1.0"),
    "the new release goes above the old one",
  );
  assert.match(merged, /The first release\./, "the existing entry survives");
});

test("a changelog with no releases yet gets the first section appended", () => {
  const merged = prependToChangelog("# Changelog\n\nNothing yet.\n", "## 0.1.0\n\nFirst.\n");
  assert.match(merged, /Nothing yet\.\n\n## 0\.1\.0/);
});
