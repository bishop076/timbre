# How we work in Timbre

**One search across free music. Nothing stored, nothing hosted.** Any change that starts
storing or hosting audio is an architecture question, not a slice — bring it to me.

## The deal

You say a goal. I reply with a five-line **slice contract**. You accept, edit, or veto it.
Then I execute the whole slice without check-ins and hand you a review note. No "watch me type."

## You own (rarely, high leverage)

- Goals and non-goals
- Architecture gates: provider boundaries (`packages/providers`), what lives in `apps/web`
  vs `packages/core`, the sidecar's surface, route shapes, caching policy
- Accept or reject the slice contract before I touch code
- **Anything visual.** See the UI rule below — it is the one place autonomy stops.

## I own (default)

- Implementing the accepted slice end-to-end: write it, run it, fix the compile, pass the gates
- Naming, file splits, and equivalent approaches *inside* the contract — I don't ask
- Committing and pushing when the slice is done and green (not for UI — see below)
- A short review note: what changed, what I assumed, how to verify in one command

## The slice contract

Five lines, before any code:

    Slice:   what you'll be able to do or see when this is done
    Touches: the files/dirs I expect to change — anything outside this is a new slice
    Not:     the adjacent things I will deliberately leave alone
    Done:    an observable check — a command, a route, a thing on screen
    Risk:    the one thing most likely to go wrong, and my fallback

Real example:

    Slice:   /api/art answers a refused upstream with 502 + a typed reason, not 404 "Not an image"
    Touches: apps/web/app/api/art/route.ts and its test
    Not:     the art cache policy, /api/resolve, any UI
    Done:    pnpm test green; prod run on :3100 shows 502 and cache-control: no-store
             in the network panel for a refused cover
    Risk:    the art cache can mask the refusal — I verify against a cold .next-prod build

## Done means (the acceptance checklist)

Every slice, in order. "It compiles" is not done.

1. `pnpm typecheck:fast` — tsgo, ~6s. **CI gates on `pnpm typecheck` (tsc)**, so that one
   runs before I push.
2. `pnpm lint` — eslint is the gate. **Never run prettier here**; it rewraps whole files to 80
   columns and buries the change.
3. `pnpm test`
4. `pnpm build`
5. **A production browser run** — if the slice touched `app/`, `lib/`, an API route, or
   `next.config.ts`, gates 1–4 do not count as verification:

       TIMBRE_DIST_DIR=.next-prod NODE_ENV=production pnpm build
       # sidecar first, then:
       TIMBRE_DIST_DIR=.next-prod NODE_ENV=production ./node_modules/.bin/dotenv -e .env -- \
         ./apps/web/node_modules/.bin/next start apps/web -p 3100

   Then drive it with the chrome-devtools MCP and read the **console and network panels**, not
   the screenshot. A dev server cannot substitute: it grants `'unsafe-eval'` and renders a
   different CSP. That build makes typegen rewrite `apps/web/tsconfig.json` with `.next-prod`
   includes — revert that before committing.

The bugs this repo actually ships are in *what the app says when something goes wrong* — error
shapes, cache-control on failures, misattributed blame. Unit tests assert the happy path.
Step 5 is the one that catches them.

## The UI carve-out

Autonomy stops at anything you can see.

- Make the change **as literally asked**. "Shorter" means shorter, not removed. If the request
  has more than one reading (crop vs shrink vs trim padding), I ask with a preview instead of
  picking.
- **Never push UI work you haven't seen.** Before/after screenshots at **1536x690** (your 1920px
  screen at 125%) — judged at your size, not mine.
- I don't offer "commit + push" as the recommended option for a visual change. Showing it first
  is the recommendation.
- A fix already sitting on another branch is not evidence you want it live. "Already written and
  tested" says nothing about whether it looks right.

## Stop at the boundary

- No "while I was there" rewrites. Something outside `Touches:` that needs fixing becomes a new
  contract, not a bigger diff.
- **Stage by explicit path.** Never `git add -A`, `git stash`, or `--autostash` — other sessions
  are live in this tree. I survey their dirty files before I start, not just before I stage.
- Commits are backdated in `+0700` with the silent types; build and push via a throwaway worktree.
- `.githooks/pre-commit` runs `scripts/check-staged-imports.mts`. If it fires, I fix the import,
  not the hook.
- Verify against prod, not the dev server — dev-only config hides prod-only bugs.
- Two dev servers corrupt `.next` and every page 500s with a Turbopack CSS error. One server.

## Known traps that are not bugs

- **YouTube playback breaks per PIA exit IP** — probe with `/tmp/pw/probe150.mjs` before touching
  player code.
- **Deezer localises by IP** — a Tokyo exit returns Japanese names and genres.
- **Spotify never plays in full without an account**; prod lacks SoundCloud search, local has it.
- Art and chart caches hide upstream outages. A cold build is the honest test.

## Parallel agents

Useful for genuinely disjoint tracks (provider work vs UI vs docs). Wrong before the architecture
is locked — you'd review three times the noise.

When we do it: each agent gets its own slice contract naming its own `Touches:` paths, the sets
must not overlap, and every one of them stages by explicit path. You still only approve slice goals.
