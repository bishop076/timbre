// Four things `node --test` cannot do with this app's modules, all resolved here so the suite
// can reach them. None of them changes how anything resolves in a build.
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
// not, so the extension has to be put back. The same is true of every *relative* import
// inside a component — `./artwork-url`, `./icons` — which is why the probe below is applied
// to those as well, and not only to the alias.
//
// 3. Node cannot parse JSX at all: a `.tsx` entry fails with ERR_UNKNOWN_FILE_EXTENSION
//    before a single line runs, which is why the test glob could not simply be widened to
//    match one. The load hook hands `.tsx` to TypeScript's `transpileModule` — already a
//    devDependency, so this costs no new package — and returns plain ESM.
//
// 4. React 19 ships CJS whose entry is `module.exports = require("./cjs/...")`. Node's
//    named-export detection cannot see through that reassignment, so `import { useState }
//    from "react"` fails with "does not provide an export named". Importing the *resolved
//    file* gets the whole namespace as a default binding; the shim below re-exports its keys
//    by name, which is the shape the source already expects. `react-dom/server` is the one
//    that matters most: it renders a component to markup with no DOM in the process.
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const ROOT = pathToFileURL(path.join(import.meta.dirname, "/")).href;
const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

// Returns a rewritten URL only when an extension actually had to be supplied. Answering
// `null` otherwise matters: a bare `next(url)` would hand a `file:` URL to whichever loader
// asked, and CJS `require` — which React's own internals run on — cannot take one.
function probe(base) {
  for (const extension of EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

const shims = new Map();
// `require.resolve` and `require` below re-enter this very hook, so the React branch has to
// stand aside while a shim is being built or it recurses until the stack gives out.
let building = false;

// Built from the package's own keys rather than a hand-written list, so a React minor that
// adds an export does not quietly break a test with a name this file failed to predict.
function cjsShim(specifier) {
  const cached = shims.get(specifier);
  if (cached) return cached;

  building = true;
  let file;
  let names;
  try {
    file = pathToFileURL(require.resolve(specifier)).href;
    names = Object.keys(require(specifier)).filter(
      (key) => key !== "default" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key),
    );
  } finally {
    building = false;
  }
  const source =
    `import namespace from ${JSON.stringify(file)};\n` +
    `export default namespace;\n` +
    (names.length > 0 ? `export const { ${names.join(", ")} } = namespace;\n` : "");

  const shim = `data:text/javascript,${encodeURIComponent(source)}`;
  shims.set(specifier, shim);
  return shim;
}

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    if (!building && /^react(-dom)?(\/|$)/.test(specifier)) {
      return { url: cjsShim(specifier), format: "module", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const base = new URL(specifier.slice(2), ROOT).href;
      return next(probe(base) ?? base, context);
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      const found = probe(new URL(specifier, context.parentURL ?? ROOT).href);
      return next(found ?? specifier, context);
    }
    return next(specifier, context);
  },

  load(url, context, next) {
    if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);

    const file = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      // `isolatedModules` matches how Next compiles this app: one file at a time, no type
      // information. Anything that needs more than that is already a build error.
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        isolatedModules: true,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  },
});
