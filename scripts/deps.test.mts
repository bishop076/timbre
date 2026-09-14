import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The dependency list is an architecture gate, not a slice decision.
 *
 * `pnpm audit` answers "is anything we ship vulnerable"; nothing answered "did
 * something new arrive". A seventh runtime dependency in the web app used to pass
 * typecheck, lint, test and build without a word, so the rule held
 * only as long as everyone remembered it. This turns forgetting into a red test.
 *
 * devDependencies are pinned too, because that is where the stack's rejected
 * alternatives would land: vitest, jest and prettier are all dev-only installs,
 * and each one silently undoes a decision the repo has already made.
 *
 * When you genuinely mean to add one, this test is the place you say so — edit
 * the list in the same commit and the diff shows the gate being opened.
 */
const EXPECTED: Record<string, { deps: string[]; devDeps: string[] }> = {
  "package.json": {
    deps: [],
    devDeps: ["@types/node", "@typescript/native-preview", "dotenv-cli", "typescript"],
  },
  "apps/web/package.json": {
    deps: ["@timbre/core", "@timbre/providers", "next", "react", "react-dom", "server-only", "zod"],
    devDeps: [
      "@tailwindcss/postcss",
      "@types/node",
      "@types/react",
      "@types/react-dom",
      "@typescript/native-preview",
      "eslint",
      "eslint-config-next",
      "tailwindcss",
      "typescript",
    ],
  },
  "packages/core/package.json": {
    deps: [],
    devDeps: ["@types/node", "@typescript/native-preview", "typescript"],
  },
  "packages/providers/package.json": {
    deps: ["@timbre/core"],
    devDeps: ["@types/node", "@typescript/native-preview", "typescript"],
  },
};

const root = new URL("../", import.meta.url);

const read = (file: string): { dependencies?: object; devDependencies?: object } =>
  JSON.parse(readFileSync(fileURLToPath(new URL(file, root)), "utf8"));

const names = (field: object | undefined): string[] => Object.keys(field ?? {}).sort();

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`${file} declares no dependency the architecture gate has not seen`, () => {
    const manifest = read(file);
    const why = `\n\n${file} changed its dependencies. That is an architecture gate: this project\nadds no new dependency without asking. If the change is deliberate, update\nEXPECTED in scripts/deps.test.mts in the same commit.\n`;

    assert.deepEqual(names(manifest.dependencies), [...expected.deps].sort(), why);
    assert.deepEqual(names(manifest.devDependencies), [...expected.devDeps].sort(), why);
  });
}

test("the rejected alternatives are not installed anywhere", () => {
  // The project's stack rules name these by name. Catching them here rather
  // than only in the per-file lists means the failure says *what* rule broke.
  const rejected = ["prettier", "vitest", "jest", "@types/jest", "shadcn-ui", "@mui/material", "@radix-ui/react-slot"];

  for (const file of Object.keys(EXPECTED)) {
    const manifest = read(file);
    const installed = new Set([...names(manifest.dependencies), ...names(manifest.devDependencies)]);

    for (const banned of rejected) {
      assert.ok(
        !installed.has(banned),
        `${file} installs ${banned}, which this project's stack rules out.`,
      );
    }
  }
});
