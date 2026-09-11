#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" });

const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /\.(ts|tsx|mts|js|jsx)$/.test(line));

if (staged.length === 0) process.exit(0);

const known = new Set(
  git("ls-files", "--cached").split("\n").map((line) => line.trim()).filter(Boolean),
);
for (const file of staged) known.add(file);

const RELATIVE = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;

const CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", "/index.ts", "/index.tsx"];

interface Problem {
  file: string;
  specifier: string;
  onDisk: string | undefined;
}

const problems: Problem[] = [];

for (const file of staged) {
  const source = git("show", `:${file}`);
  const dir = path.posix.dirname(file);

  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  for (const match of code.matchAll(RELATIVE)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    const base = path.posix.normalize(path.posix.join(dir, specifier));
    const resolved = CANDIDATES.map((suffix) => base + suffix).find((candidate) =>
      known.has(candidate),
    );
    if (resolved) continue;

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
