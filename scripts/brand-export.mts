#!/usr/bin/env node

// Refreshes the exported copies under docs/brand/logo from the files the app actually ships, and
// with --check fails if they have diverged. The kit is meant to be openable on its own — someone
// wanting the logo should not have to know that the icon lives in apps/web/app and the rasters in
// apps/web/public — but a copy that nobody regenerates is a copy that rots, so this exists to make
// the drift catchable. CI does not run it; `--check` is here for when the mark is touched.
//
// docs/brand/banners/* is NOT listed: those are canonical where they sit, generated from
// readme-banner.tsx by the dance in docs/brand/README.md. Nothing copies them.

import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = (path: string) => resolve(root, path);

// The mark has no standalone file in the app — it is a JSX path in brand.tsx — so it is extracted
// rather than copied. Everything else is a straight copy.
const MARK_SOURCE = "apps/web/app/shell/brand.tsx";
const MARK_EXPORT = "docs/brand/logo/timbre-mark.svg";

const COPIES: Array<[from: string, to: string]> = [
  ["apps/web/app/icon.svg", "docs/brand/logo/timbre-icon.svg"],
  ["apps/web/app/favicon.ico", "docs/brand/logo/favicon.ico"],
  ["apps/web/public/icon-192.png", "docs/brand/logo/timbre-icon-192.png"],
  ["apps/web/public/icon-512.png", "docs/brand/logo/timbre-icon-512.png"],
  ["apps/web/public/icon-maskable-512.png", "docs/brand/logo/timbre-icon-maskable-512.png"],
];

function markSvg(): string {
  const source = readFileSync(at(MARK_SOURCE), "utf8");
  const path = / d="([^"]+)"/.exec(source)?.[1];
  if (!path) throw new Error(`no path data found in ${MARK_SOURCE}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 247 282" width="247" height="282" fill="none">\n  <path d="${path}" fill="currentColor" />\n</svg>\n`;
}

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

const check = process.argv.includes("--check");
const stale: string[] = [];

const wanted = Buffer.from(markSvg());
if (digest(readFileSync(at(MARK_EXPORT))) !== digest(wanted)) {
  stale.push(MARK_EXPORT);
  if (!check) writeFileSync(at(MARK_EXPORT), wanted);
}

for (const [from, to] of COPIES) {
  if (digest(readFileSync(at(from))) === digest(readFileSync(at(to)))) continue;
  stale.push(to);
  if (!check) copyFileSync(at(from), at(to));
}

if (stale.length === 0) {
  console.log("[brand-export] docs/brand matches the app");
  process.exit(0);
}

if (check) {
  console.error(`[brand-export] stale, run \`node scripts/brand-export.mts\`:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}

console.log(`[brand-export] refreshed:\n  ${stale.join("\n  ")}`);
