import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bumpFor,
  nextVersion,
  notesFor,
  parseCommit,
  prependToChangelog,
} from "./release.mjs";

/*
 * The version number is chosen by a machine and pushed to a tag nobody reviews, so
 * the arithmetic gets tests. Everything here is pure — no git, no filesystem.
 */

const at = new Date("2026-08-18T09:00:00Z");
const parse = (...messages) => messages.map(parseCommit);

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
  // A merge, or a message written by hand, must neither bump nor appear in the notes.
  assert.equal(parseCommit("Merge branch 'main'"), null);
  assert.equal(parseCommit("wip"), null);
  assert.equal(parseCommit(""), null);
});

test("both breaking-change markers are recognised", () => {
  assert.equal(parseCommit("feat!: drop the old store").breaking, true);
  assert.equal(parseCommit("feat(api)!: rename a field").breaking, true);
  assert.equal(
    parseCommit("refactor: move a module\n\nBREAKING CHANGE: the export moved").breaking,
    true,
  );
  assert.equal(parseCommit("feat: a normal feature").breaking, false);
});

test("silent types alone do not cut a release", () => {
  // The whole point: a docs-only or refactor-only push must not mint a version.
  const quiet = parse("docs: fix a typo", "refactor(core): tidy", "test: add a case", "ci: cache");
  assert.equal(bumpFor(quiet, "0.1.0"), null);
});

test("feat is a minor, fix and perf are patches", () => {
  assert.equal(bumpFor(parse("fix: a bug"), "1.2.3"), "patch");
  assert.equal(bumpFor(parse("perf: quicker"), "1.2.3"), "patch");
  assert.equal(bumpFor(parse("feat: a thing", "fix: a bug"), "1.2.3"), "minor");
});

test("below 1.0.0 a breaking change is a minor, not a major", () => {
  // 0.x is where the shape is still moving; promoting every break to 1.0.0 would
  // claim stability the project has not reached.
  assert.equal(bumpFor(parse("feat!: reshape the queue"), "0.1.0"), "minor");
  assert.equal(bumpFor(parse("feat!: reshape the queue"), "1.4.0"), "major");
});

test("a breaking change in an otherwise silent type still releases", () => {
  // refactor does not release on its own, but a refactor that breaks something does.
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

test("a breaking entry is marked as one", () => {
  const notes = notesFor(parse("feat(api)!: rename a field"), "0.2.0", at);
  assert.match(notes, /rename a field \(breaking\)/);
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
