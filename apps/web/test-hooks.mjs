// Two things `node --test` cannot do with this app's modules, both resolved here so the
// suite can reach them. Neither changes how anything resolves in a build.
//
// 1. `import "server-only"` throws unless the importer is a server component, which is the
//    point of it — but it also means no lib module guarding itself that way can be loaded
//    (lib/deezer.ts, lib/env.ts, lib/api.ts, and everything importing them). The documented
//    way out is `--conditions=react-server`, which is wrong here: that condition also swaps
//    React for its react-server build, which has no client hooks, and about twenty existing
//    tests fail on it. Mapping the one specifier leaves everything else alone.
//
// 2. The `@/*` path alias is a tsconfig/bundler feature, invisible to Node. `paths` maps it
//    to this directory, so that is what it becomes.
// The alias is written without a file extension, as a bundler allows and Node's ESM does
// not, so the extension has to be put back.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = pathToFileURL(path.join(import.meta.dirname, "/")).href;
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function resolveAlias(specifier) {
  const base = new URL(specifier.slice(2), ROOT).href;
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return base;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) return next(resolveAlias(specifier), context);
    return next(specifier, context);
  },
});
