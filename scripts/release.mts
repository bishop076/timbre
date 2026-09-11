import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFESTS = ["package.json", "apps/web/package.json"];

export interface Commit {
  type: string;
  scope: string | null;
  description: string;
  breaking: boolean;
}

export type Bump = "major" | "minor" | "patch";

const RELEASING: Readonly<Record<string, string>> = {
  feat: "Added",
  fix: "Fixed",
  perf: "Faster",
};

const SILENT = ["docs", "chore", "refactor", "test", "ci", "build", "style", "revert"];

const git = (...args: string[]): string =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

function lastTag(): string | null {
  try {
    return git("describe", "--tags", "--abbrev=0", "--match", "v*") || null;
  } catch {
    return null;
  }
}

export function parseCommit(message: string): Commit | null {
  const [subject, ...rest] = message.split("\n");
  const match = /^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/.exec(subject ?? "");
  if (!match) return null;

  const [, type = "", scope, bang, description = ""] = match;
  const breaking = bang === "!" || /^BREAKING[ -]CHANGE:/m.test(rest.join("\n"));
  return { type, scope: scope ?? null, description, breaking };
}

export function bumpFor(commits: readonly (Commit | null)[], currentVersion: string): Bump | null {
  const releasing = commits.filter(
    (c): c is Commit => c !== null && (RELEASING[c.type] !== undefined || c.breaking),
  );
  if (releasing.length === 0) return null;
  if (releasing.some((c) => c.breaking)) {
    return currentVersion.startsWith("0.") ? "minor" : "major";
  }
  return releasing.some((c) => c.type === "feat") ? "minor" : "patch";
}

export function nextVersion(current: string, bump: Bump): string {
  const parts = current.split(".").map(Number);
  if (parts.length !== 3 || !parts.every(Number.isInteger)) {
    throw new Error(`not a semver version: ${current}`);
  }
  const [major, minor, patch] = parts as [number, number, number];
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function humanDate(when?: string | Date): string {
  const iso = typeof when === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(when) : null;
  if (iso) {
    const [, year, month, day] = iso;
    return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
  }
  const date = when instanceof Date ? when : new Date();
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function notesFor(
  commits: readonly (Commit | null)[],
  version: string,
  now?: string | Date,
): string {
  const parsed = commits.filter((c): c is Commit => c !== null);
  const lines = [`## ${version} — ${humanDate(now)}`, ""];
  const section = (heading: string, group: Commit[]) => {
    if (group.length === 0) return;
    const entries = group.map((c) => `- ${c.scope ? `**${c.scope}** — ` : ""}${c.description}`);
    lines.push(`### ${heading}`, "", ...entries, "");
  };

  section("Breaking", parsed.filter((c) => c.breaking));
  for (const [type, heading] of Object.entries(RELEASING)) {
    section(heading, parsed.filter((c) => c.type === type && !c.breaking));
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

export function prependToChangelog(existing: string, section: string): string {
  const firstRelease = existing.indexOf("\n## ") + 1;
  if (firstRelease === 0) return `${existing.trimEnd()}\n\n${section}`;
  return `${existing.slice(0, firstRelease)}${section}\n${existing.slice(firstRelease)}`;
}

function output(text: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, text);
}

function main(): void {
  const tag = lastTag();
  const messages = git("log", tag ? `${tag}..HEAD` : "HEAD", "--no-merges", "--format=%B%x00")
    .split("\0")
    .map((m) => m.trim())
    .filter(Boolean);
  const commits = messages.map(parseCommit);

  const manifestPath = path.join(ROOT, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version?: unknown } | null;
  const current = manifest?.version;
  if (typeof current !== "string") {
    throw new Error(`no "version" string in ${manifestPath}`);
  }
  const bump = bumpFor(commits, current);

  console.log(`last tag       ${tag ?? "(none)"}`);
  console.log(`commits        ${messages.length}`);
  console.log(`current        ${current}`);

  if (!bump) {
    console.log("decision       nothing to release (no feat, fix or perf since the last tag)");
    output("released=false\n");
    return;
  }

  const version = nextVersion(current, bump);
  const section = notesFor(commits, version, process.env.RELEASE_DATE || new Date());

  console.log(`decision       ${bump} -> ${version}`);
  console.log(`\n${section}`);

  if (process.argv.includes("--dry-run")) {
    console.log("(dry run: nothing written)");
    return;
  }

  for (const relative of MANIFESTS) {
    const file = path.join(ROOT, relative);
    const text = readFileSync(file, "utf8");
    const updated = text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`);
    if (updated === text) throw new Error(`no version field replaced in ${relative}`);
    writeFileSync(file, updated);
  }

  const changelog = path.join(ROOT, "CHANGELOG.md");
  writeFileSync(changelog, prependToChangelog(readFileSync(changelog, "utf8"), section));
  output(`released=true\nversion=${version}\ntag=v${version}\n`);
  writeFileSync(path.join(ROOT, "RELEASE_NOTES.md"), section);
}

const entryPoint = process.argv[1];
if (entryPoint && path.resolve(entryPoint) === path.resolve(import.meta.filename)) {
  main();
}
