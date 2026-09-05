#!/usr/bin/env node
/**
 * Refuses a commit that would not build for anyone who checked it out.
 *
 * **The failure this exists for happened twice on 2026-08-20.** Two agents share one working
 * directory, so `git add <path>` stages the *whole file* — including edits the other agent
 * was midway through. The second time, `search-results.tsx` was swept in while it imported a
 * brand-new `./source-badges`, and that file was still untracked. The commit therefore
 * referenced something that did not exist in it: HEAD was broken, and nothing said so,
 * because the working tree had the file and every check passed locally.
 *
 * A hook cannot tell whose hunk is whose. It can tell that a staged file imports a sibling
 * that is neither committed nor staged, which is the consequence that actually matters and
 * is exactly what both incidents produced.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" });

/** Staged, and still present — a rename's old path is not something to resolve against. */
const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACM")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /\.(ts|tsx|mts|js|jsx)$/.test(line));

if (staged.length === 0) process.exit(0);

/** Everything git will have after this commit: what is committed, plus what is staged. */
const known = new Set(
  git("ls-files", "--cached").split("\n").map((line) => line.trim()).filter(Boolean),
);
for (const file of staged) known.add(file);

/** `import … from "./x"`, `export … from "../x"`, and `import("./x")`. */
const RELATIVE = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

/** What TypeScript will try, in order, for a specifier with no extension. */
const CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", "/index.ts", "/index.tsx"];

interface Problem {
  file: string;
  specifier: string;
  /** The candidate that exists in the working tree but not in git, if that is the failure. */
  onDisk: string | undefined;
}

const problems: Problem[] = [];

for (const file of staged) {
  const source = git("show", `:${file}`);
  const dir = path.posix.dirname(file);

  for (const match of source.matchAll(RELATIVE)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    // `./x.ts` is how this repo imports some modules; the resolver tries the literal first.
    const base = path.posix.normalize(path.posix.join(dir, specifier));
    const resolved = CANDIDATES.map((suffix) => base + suffix).find((candidate) =>
      known.has(candidate),
    );
    if (resolved) continue;

    // Present on disk but unknown to git is the exact shape of the bug: it builds here and
    // nowhere else. Absent entirely is an ordinary broken import, and worth stopping too.
    const onDisk = CANDIDATES.map((suffix) => base + suffix).find((candidate) =>
      existsSync(candidate),
    );
    problems.push({ file, specifier, onDisk });
  }
}

if (problems.length === 0) process.exit(0);

console.error("\nThis commit would not build for anyone who checked it out.\n");
for (const { file, specifier, onDisk } of problems) {
  console.error(`  ${file}`);
  console.error(`    imports ${JSON.stringify(specifier)}`);
  console.error(
    onDisk
      ? `    -> ${onDisk} exists here but is NOT tracked or staged, so the commit is missing it`
      : `    -> resolves to nothing`,
  );
}
console.error(
  [
    "",
    "If that file is someone else's work in progress, you have staged a whole file you only",
    "partly wrote — see notes/WORKSTREAMS.md. Rebuild the staged copy from HEAD plus your own",
    "change rather than adding the path, or stage the missing file deliberately.",
    "",
  ].join("\n"),
);
process.exit(1);
