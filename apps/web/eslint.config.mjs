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
    ".next-prod/**",
  ]),
]);

export default eslintConfig;
