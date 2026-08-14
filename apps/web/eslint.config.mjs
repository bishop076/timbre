import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Where a production build goes when it must not disturb the dev server's
    // `.next` — see `distDir` in `next.config.ts`. Without this, linting the
    // repo lints Turbopack's own output and reports hundreds of errors in
    // generated chunks nobody wrote.
    //
    // A glob, because `distDir` is whatever `TIMBRE_DIST_DIR` says. Naming
    // `.next-prod` alone meant the next name anybody picked — `.next-ci` — got
    // linted, and the run failed on Turbopack's `require()` calls.
    ".next-*/**",
  ]),
]);

export default eslintConfig;
