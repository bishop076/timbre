/**
 * Works out the next version from the commit log, and writes it everywhere.
 *
 * Timbre's commits are strict conventional commits, so the version does not need
 * a human to choose it: the *types* since the last tag already say whether this is
 * a feature release or a fix. This reads them, bumps `package.json` in both places,
 * prepends a section to CHANGELOG.md, and prints what the workflow needs to tag and
 * publish.
 *
 * `--dry-run` writes nothing and prints what would happen, which is how to check it
 * before letting it near a repository.
 *
 * Deliberately a script rather than a pile of YAML: the interesting part is the
 * version arithmetic, and that belongs somewhere it can be read and tested. See
 * release.test.mts.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFESTS = ["package.json", "apps/web/package.json"];
const CHANGELOG = "CHANGELOG.md";

/** One conventional commit, parsed. */
export interface Commit {
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
}

/** Which part of the version moves. */
export type Bump = "major" | "minor" | "patch";

/** Types that make a release, and the heading each gets in the notes. */
const RELEASING: Readonly<Record<string, string>> = {
  feat: "Added",
  fix: "Fixed",
  perf: "Faster",
};

/*
 * Types that are real work but change nothing a listener can see, so they must not
 * cut a release on their own. A docs-only push should not mint a version.
 */
const SILENT = ["docs", "chore", "refactor", "test", "ci", "build", "style", "revert"];

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** The most recent version tag, or null on a repository that has never released. */
export function lastTag(): string | null {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*") || null;
  } catch {
    return null;
  }
}

/**
 * One commit, parsed. Returns null for anything that is not a conventional commit —
 * a merge, or a message written by hand — so it neither bumps nor appears.
 */
export function parseCommit(message: string): Commit | null {
  const [subject, ...rest] = message.split("\n");
  const match = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject ?? "");
  if (!match) return null;

  const [, type = "", scope, bang, description = ""] = match;
  // Either marker counts: `feat!:` in the subject, or a footer in the body.
  const breaking = bang === "!" || /^BREAKING[ -]CHANGE:/m.test(rest.join("\n"));
  return { type, scope: scope ?? null, description, breaking };
}

/**
 * Which part of the version moves, or null for "do not release".
 *
 * **Below 1.0.0 a breaking change bumps the minor, not the major.** That is the
 * conventional reading of a 0.x line: 0.x is where the shape is still moving, and
 * promoting every break to 1.0.0 would say the opposite.
 */
export function bumpFor(commits: readonly (Commit | null)[], currentVersion: string): Bump | null {
  const releasing = commits.filter(
    (c): c is Commit => c !== null && (RELEASING[c.type] !== undefined || c.breaking),
  );
  if (releasing.length === 0) return null;

  const preMajor = currentVersion.startsWith("0.");
  if (releasing.some((c) => c.breaking)) return preMajor ? "minor" : "major";
  if (releasing.some((c) => c.type === "feat")) return "minor";
  return "patch";
}

/** Applies a bump to a semver string. */
export function nextVersion(current: string, bump: Bump): string {
  const parts = current.split(".").map(Number);
  const [major, minor, patch] = parts;
  if (
    parts.length !== 3 ||
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    parts.some((n) => !Number.isInteger(n))
  ) {
    throw new Error(`not a semver version: ${current}`);
  }
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A date the way the changelog writes them: "17 August 2026".
 *
 * **Takes the ISO string's own date, not a Date's.** A commit timestamp carries the
 * author's offset, and `toLocaleDateString` re-expresses it in whatever zone the
 * process is in — which on a runner is UTC. So a commit made at 00:44 +0700 came out
 * dated the day before, and this project's history is mostly late-night work, so that
 * was going to be wrong more often than right. The calendar date somebody was living
 * in when they committed is the one that belongs in a changelog.
 */
export function humanDate(when?: string | Date): string {
  const iso = typeof when === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(when) : null;
  if (iso) {
    const [, year, month, day] = iso;
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  }
  // No timestamp given: a local run, where the local zone is the right answer.
  const date = when instanceof Date ? when : new Date();
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/**
 * The release notes, grouped and written for a reader.
 *
 * Silent types are summarised as a count rather than listed. Somebody reading a
 * changelog does not want thirty refactor subjects, but "and 30 changes under the
 * hood" is honest about the release not being empty.
 */
export function notesFor(
  commits: readonly (Commit | null)[],
  version: string,
  now?: string | Date,
): string {
  const parsed = commits.filter((c): c is Commit => c !== null);
  const lines = [`## ${version} — ${humanDate(now)}`, ""];
  const entry = (commit: Commit) =>
    `- ${commit.scope ? `**${commit.scope}** — ` : ""}${commit.description}`;

  /*
   * Breaking changes lead, and are listed whatever their type.
   *
   * `bumpFor` releases on any breaking commit, including types that are otherwise
   * silent — so a `refactor!:` alone cut a version whose notes had no section to put
   * it in and no quiet-work count either (that line excludes breaking). The Release
   * body came out as a bare heading. Listing them here is what makes "released
   * implies at least one section" true by construction.
   */
  const breaking = parsed.filter((c) => c.breaking);
  if (breaking.length > 0) {
    lines.push("### Breaking", "");
    for (const commit of breaking) lines.push(entry(commit));
    lines.push("");
  }

  for (const [type, heading] of Object.entries(RELEASING)) {
    // Breaking ones are above already; listing them twice reads as two changes.
    const group = parsed.filter((c) => c.type === type && !c.breaking);
    if (group.length === 0) continue;
    lines.push(`### ${heading}`, "");
    for (const commit of group) lines.push(entry(commit));
    lines.push("");
  }

  const quiet = parsed.filter((c) => SILENT.includes(c.type) && !c.breaking).length;
  if (quiet > 0) {
    lines.push(
      `${quiet} further ${quiet === 1 ? "change" : "changes"} under the hood — refactoring, docs and tests.`,
      "",
    );
  }

  return lines.join("\n");
}

/** Inserts a section directly after the changelog's preamble, newest first. */
export function prependToChangelog(existing: string, section: string): string {
  const firstRelease = existing.indexOf("\n## ");
  if (firstRelease === -1) return `${existing.trimEnd()}\n\n${section}`;
  const head = existing.slice(0, firstRelease + 1);
  const tail = existing.slice(firstRelease + 1);
  return `${head}${section}\n${tail}`;
}

function main(): void {
  const dryRun = process.argv.includes("--dry-run");
  const tag = lastTag();
  const range = tag ? `${tag}..HEAD` : "HEAD";

  // %B is the raw body, and the NUL separator survives subjects containing anything.
  const raw = git("log", range, "--no-merges", "--format=%B%x00");
  const messages = raw
    .split("\0")
    .map((m) => m.trim())
    .filter(Boolean);
  const commits = messages.map(parseCommit);

  const manifestPath = path.join(ROOT, MANIFESTS[0] ?? "package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const current =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? manifest.version
      : undefined;
  if (typeof current !== "string") {
    throw new Error(`no "version" string in ${manifestPath}`);
  }
  const bump = bumpFor(commits, current);

  console.log(`last tag       ${tag ?? "(none)"}`);
  console.log(`commits        ${messages.length}`);
  console.log(`current        ${current}`);

  if (!bump) {
    console.log("decision       nothing to release (no feat, fix or perf since the last tag)");
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, "released=false\n");
    }
    return;
  }

  const version = nextVersion(current, bump);
  // Passed in by the workflow so a re-run produces the same notes; local runs use now.
  // The raw ISO string, not a Date: it carries the author's offset, and humanDate
  // reads the calendar date out of it rather than re-expressing it in the runner's.
  const now = process.env.RELEASE_DATE || new Date();
  const section = notesFor(commits, version, now);

  console.log(`decision       ${bump} -> ${version}`);
  console.log(`\n${section}`);

  if (dryRun) {
    console.log("(dry run: nothing written)");
    return;
  }

  for (const relative of MANIFESTS) {
    const file = path.join(ROOT, relative);
    const text = readFileSync(file, "utf8");
    // A targeted replacement of the top-level "version" only. JSON.parse would
    // reformat the whole manifest and lose its key order.
    const updated = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
    if (updated === text) throw new Error(`no version field replaced in ${relative}`);
    writeFileSync(file, updated);
  }

  const changelog = path.join(ROOT, CHANGELOG);
  writeFileSync(changelog, prependToChangelog(readFileSync(changelog, "utf8"), section));

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `released=true\nversion=${version}\ntag=v${version}\n`,
    );
  }
  // The workflow reads this file for the Release body rather than re-deriving it.
  writeFileSync(path.join(ROOT, "RELEASE_NOTES.md"), section);
}

// Importable for the tests without running.
const entryPoint = process.argv[1];
if (entryPoint && path.resolve(entryPoint) === path.resolve(import.meta.filename)) {
  main();
}
