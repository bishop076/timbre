# apps/web

- **`server-only` marks the boundary, and the boundary is `lib/`.** It appears in exactly 12 files,
  all of them there; nothing under `app/` imports it. A new module that reads env, calls a provider
  or touches the network belongs in `lib/` with that import — not beside the component that wanted it.
- **Every route goes through `lib/api.ts`, and every route has a budget** — `queryRoute(schema,
  message, handler)` when there are query params, `guard(request, budget)` otherwise. Taking no
  parameters is not an exemption: a cache miss still fans out to every provider. A route that
  rate-limits itself by hand or parses its own search params is a route that got it wrong.
- **The dependency list is gated by a test**, not by memory — `scripts/deps.test.mts` fails if any
  manifest gains or loses one. Adding a dependency means editing that list in the same commit.
- **The runtime dependency list is closed**: `@timbre/core`, `@timbre/providers`, `next`, `react`,
  `react-dom`, `server-only`, `zod`. Adding to it is an architecture gate, not a slice decision.

Everything else — the rules, the stack, the slice contract, the verification checklist, what a push
to `main` publishes — is in the root `CLAUDE.md`.

<!-- Next.js rewrites AGENTS.md on `next dev`, so nothing project-specific survives in there.
     It is imported for the Next 16 docs pointer only. -->
@AGENTS.md
