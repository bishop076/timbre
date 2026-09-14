import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".next-*/**", "public/sw.js"]),
  {
    rules: {
      // "Delete, don't flag" was true by discipline and nothing else — the source
      // carries zero deferral markers today, and only habit was keeping it that way.
      //
      // The term list stays short on purpose. Words like "hack" and "xxx" read as
      // ordinary prose in a repo whose comments argue at length about why something is
      // the way it is, and a rule that fires on an honest sentence is one that gets
      // switched off. Note that the terms below match anywhere in a comment, so this
      // rule will flag the very words it screens for — including in a note like this.
      "no-warning-comments": ["error", { terms: ["todo", "fixme"], location: "anywhere" }],
    },
  },
]);
