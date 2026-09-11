#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const git = (...args: string[]): string => execFileSync("git", args, { encoding: "utf8" });
const lines = (text: string) => text.split("\n").map((line) => line.trim());

const staged = lines(git("diff", "--cached", "--name-only", "--diff-filter=ACMR")).filter((line) =>
  /\.(ts|tsx|mts|js|jsx)$/.test(line),
);
const known = new Set([...lines(git("ls-files", "--cached")), ...staged]);

const RELATIVE = /(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g;
const CANDIDATES = ["", ".ts", ".tsx", ".mts", ".js", ".jsx", "/index.ts", "/index.tsx"];

const problems: { file: string; specifier: string; onDisk: string | undefined }[] = [];

for (const file of staged) {
  const code = git("show", `:${file}`)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  for (const [, specifier = ""] of code.matchAll(RELATIVE)) {
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    const candidates = CANDIDATES.map((suffix) => base + suffix);
    if (candidates.some((candidate) => known.has(candidate))) continue;
    problems.push({ file, specifier, onDisk: candidates.find((candidate) => existsSync(candidate)) });
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
