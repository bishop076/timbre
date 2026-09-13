// `import "server-only"` throws unless the importer is a server component, which is the whole
// point of it — but it also means `node --test` cannot load any lib module that guards itself
// that way (lib/deezer.ts, lib/env.ts, lib/api.ts, and everything importing them).
//
// The documented way out is `--conditions=react-server`, which resolves the package to its
// empty module. Do not use it here: that condition also swaps React for its react-server
// build, which has no client hooks, and roughly twenty existing tests fail on it. This maps
// the one specifier and leaves resolution otherwise untouched.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    }
    return next(specifier, context);
  },
});
