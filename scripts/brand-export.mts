#!/usr/bin/env node

// Refreshes docs/brand/logo/app-icon from the icon files the app actually ships, and with --check
// fails if they have diverged. The kit is meant to be openable on its own — someone wanting the
// icon should not have to know it lives in apps/web/app and the rasters in apps/web/public — but a
// copy that nobody regenerates is a copy that rots, so this exists to make the drift catchable.
// CI does not run it; `--check` is here for when the icon is touched.
//
// Only the app icon is copied. The mark, wordmark, lockup and avatar tiles are *generated* by
// scripts/brand-assets.mts from the palm path and the two brand faces — run that, not this, after
// changing the mark. docs/brand/banners/* is canonical where it sits, produced from
// readme-banner.tsx by the dance in docs/brand/README.md, and nothing copies it.

import { createHash } from "node:crypto";
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = (path: string) => resolve(root, path);

const COPIES: Array<[from: string, to: string]> = [
  ["apps/web/app/icon.svg", "docs/brand/logo/app-icon/icon.svg"],
  ["apps/web/app/favicon.ico", "docs/brand/logo/app-icon/favicon.ico"],
  ["apps/web/public/icon-192.png", "docs/brand/logo/app-icon/icon-192.png"],
  ["apps/web/public/icon-512.png", "docs/brand/logo/app-icon/icon-512.png"],
  ["apps/web/public/icon-maskable-512.png", "docs/brand/logo/app-icon/icon-maskable-512.png"],
];

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");

const check = process.argv.includes("--check");
const stale: string[] = [];

for (const [from, to] of COPIES) {
  if (digest(readFileSync(at(from))) === digest(readFileSync(at(to)))) continue;
  stale.push(to);
  if (!check) copyFileSync(at(from), at(to));
}

if (stale.length === 0) {
  console.log("[brand-export] docs/brand/logo/app-icon matches the app");
  process.exit(0);
}

if (check) {
  console.error(`[brand-export] stale, run \`node scripts/brand-export.mts\`:\n  ${stale.join("\n  ")}`);
  process.exit(1);
}

console.log(`[brand-export] refreshed:\n  ${stale.join("\n  ")}`);
