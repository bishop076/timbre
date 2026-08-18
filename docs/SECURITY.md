# Security review

A vulnerability pass over Timbre, mapped to the **OWASP Top 10:2025**.

*Reviewed 2026-08-18, against `1b90b08`.*

This is a different question from [EXPOSURE.md](EXPOSURE.md). That file asks what
a public deployment *spends* and what it *risks by policy*. This one asks whether
the code can be made to do something it should not. Where the two touch, this
file cross-references rather than repeats.

**Scope:** `apps/web`, `apps/ytmusic`, `packages/core`, `packages/providers`, the
GitHub Actions workflows, and the dependency graph of both runtimes.

**Method:** static review of every trust boundary, plus dependency audits, plus a
proof-of-concept test for the one finding that warranted one. Every finding below
was verified — none is a pattern-match on a grep.

Severity: `HIGH` · `MEDIUM` · `LOW`

---

## The short version

Timbre has an unusually small attack surface, and it earns most of that honestly.
There is **no authentication to break, no database to inject, no user record to
steal, and no server-side state to corrupt** — so five of the ten OWASP
categories barely apply. The XSS surface, which is the one that should worry an
app that embeds third-party players, is genuinely clean: there is exactly one
`dangerouslySetInnerHTML` and it interpolates nothing, and there is not a single
`postMessage` listener in the codebase.

One finding is serious, is proven, and is not on the server.

---

# S-1 · A crafted playlist file permanently bricks the app `HIGH`

**OWASP:** A10:2025 Mishandling of Exceptional Conditions, with A06:2025
Insecure Design underneath it — validation is missing at a trust boundary.

**Impact:** persistent client-side denial of service. Every page, not one page.
Recovery destroys all of the victim's data.

## What is wrong

`importPlaylists` (`apps/web/app/playlists/store.ts:234`) is the only place
where a file from outside Timbre becomes application state. It validates the
wrapper and the playlist objects, and **never validates the songs**:

```ts
const incoming = file.playlists.filter(
  (playlist): playlist is LocalPlaylist =>
    typeof playlist?.name === "string" && Array.isArray(playlist?.songs),
);
```

`Array.isArray` is the whole check. The array's *contents* are accepted as-is
and cast to `Song[]`, a lie the type system cannot catch because the input is
`unknown`.

Downstream, `summarise` (`store.ts:43`) assumes every element is an object:

```ts
covers: playlist.songs.map((song) => song.artworkUrl)…
```

A `null` in that array is a `TypeError`.

## Why it is persistent rather than transient

The ordering in `persist()` (`store.ts:117-126`) is what turns a crash into
permanent damage:

```ts
window.localStorage.setItem(KEY, JSON.stringify(all));   // ← poison written
…
store.publish(state(null));                              // ← then it throws
```

**Storage is written before the state that throws is computed.** So the failed
import is not rolled back — it is saved. On the next load, `readStorage`
(`store.ts:67`) has its own `try/catch` and returns the entry happily, because it
shape-checks playlists with the same insufficient check and repairs only
timestamps. `state()` then calls `summarise` **outside any `try/catch`**, and
throws again.

## Why it takes down every page

`store.read` is called from `getSnapshot`, which `useSyncExternalStore` calls
**during render**. So the `TypeError` is a render-phase throw.

`Sidebar` calls `usePlaylists()` and `loadPlaylists()`
(`apps/web/app/shell/sidebar.tsx:37,42`), and `Sidebar` is mounted in the app
shell (`apps/web/app/shell/app-shell.tsx:78`) — which wraps **every route**.

And there is **no error boundary in the application at all**: no `error.tsx`, no
`global-error.tsx` anywhere under `apps/web/app`. So the throw reaches Next's
default handler and the whole app is replaced by an error page, on every route,
on every load.

The only recovery available to a non-technical user is clearing site data —
which also deletes every legitimate playlist, the profile, and the listening
history. **The remedy destroys exactly what the attack targets.**

## Proof

Run against the real module, not a reconstruction:

```ts
const hostile = {
  format: "timbre.playlists",
  version: 1,
  playlists: [{ name: "pwn", songs: [null] }],
};

assert.throws(() => mod.importPlaylists(hostile), TypeError);   // ✔ passes
assert.match(store["timbre:playlists"] ?? "", /pwn/);           // ✔ written anyway
assert.throws(() => mod.loadPlaylists(), TypeError);            // ✔ and again, forever
```

All three assertions pass. `[null]` is the shortest payload; `[1]`, `["x"]` and
`[[]]` do not throw, so the trigger is specifically `null` or `undefined` in the
songs array — which is exactly what a truncated or hand-edited export produces
by accident.

## Delivery

The import is a deliberate user action behind a file picker
(`apps/web/app/playlists/library-view.tsx:56`), so this needs the victim to
accept a file. That is a real barrier and it is not much of one: exported
playlists are *designed* to be shared between people and devices, which is the
entire premise of the feature. A "here's my library" file is a normal thing to
send someone.

**It is also reachable without an attacker.** A truncated download, a sync
conflict, or any bug that writes a malformed entry produces the same permanent
crash. Treating this purely as an attack understates it.

## Fix

Four changes, in order of importance:

1. **Validate song elements** in `importPlaylists` — at minimum
   `typeof song === "object" && song !== null`. Drop what fails rather than
   rejecting the file, matching how `readStorage` already repairs timestamps.
2. **Validate them in `readStorage` too.** The import is one way in; storage is
   the other, and it is the one every page reads. Fixing only the import leaves
   already-poisoned browsers broken.
3. **Persist after computing state, not before**, so a throw cannot leave
   storage holding something that cannot be read back.
4. **Add `app/global-error.tsx`.** Independent of this bug: with no boundary,
   *any* render throw anywhere costs the whole application. This is the cheapest
   resilience in the entire codebase.

A regression test belongs with (1) — the payload above is the test.

---

# S-2 · No error boundary anywhere `HIGH`

**OWASP:** A10:2025 Mishandling of Exceptional Conditions.

Called out separately because it is not specific to S-1 and outlives it.

**`read`.** There is no `error.tsx` or `global-error.tsx` under `apps/web/app`.
Timbre reads five separate `localStorage` stores during render via
`useSyncExternalStore` — playlists, theme, history, lyrics preferences, artwork
accent — and each `read` is documented as owning its own `try/catch`. Four of
them do. The fifth's is incomplete, which is S-1.

That is a design that depends on every store getting its error handling exactly
right, forever, with nothing behind it if one does not.

**Fix:** `app/global-error.tsx` with a "reset Timbre's stored data" button —
which is also the recovery path S-1 currently lacks.

---

# S-3 · GitHub Actions are pinned to mutable tags, with write access `MEDIUM`

**OWASP:** A03:2025 Software Supply Chain Failures.

**`read`.** Every workflow step references a tag, not a commit:

```
actions/checkout@v4      pnpm/action-setup@v4
actions/setup-node@v4    actions/setup-python@v5
```

Tags are mutable. Whoever controls the repository behind one of those actions can
repoint `v4` at new code, and it runs on the next build with whatever permissions
the job holds.

**Why it matters more in `release.yml` than in `ci.yml`:** the release job
declares `permissions: contents: write` and runs on pushes to `main`. A
compromised action there can write to the repository and read the token that lets
it. This is the exact shape of the `tj-actions/changed-files` compromise of March
2025, which reached tens of thousands of repositories through a retagged action.

**Fix:** pin to full commit SHAs with the tag in a trailing comment —

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
```

Dependabot updates SHA pins as readily as tag pins, so this costs nothing
ongoing. Do `release.yml` first; it is the one holding a write token.

---

# S-4 · The Python service has no lockfile `MEDIUM`

**OWASP:** A03:2025 Software Supply Chain Failures.

**`read`.** `apps/ytmusic/pyproject.toml` declares open-ended ranges:

```toml
"ytmusicapi>=1.12,<2"    # bounded
"fastapi>=0.115"         # unbounded
"uvicorn[standard]>=0.32" # unbounded
"pydantic>=2.9"          # unbounded
```

There is no `uv.lock`, no `requirements.txt`, no `poetry.lock` — verified by
searching the tree. CI runs `pip install -e ".[dev]"`, and Vercel's Python
runtime installs from the same file.

**Two consequences.** Every CI run and every deployment resolves the dependency
graph fresh, so builds are not reproducible and a green run does not tell you
what a later one will install. And there is no upper bound on three of the four
direct dependencies, nor on any transitive one — a malicious or broken release
anywhere in that graph is picked up automatically, with no review step.

The contrast is instructive: the JavaScript side has `pnpm-lock.yaml` and CI runs
`pnpm install --frozen-lockfile`, so the same class of risk is already handled
there. The Python side simply never got the same treatment.

`ytmusicapi` is correctly bounded, and the comment explaining why is right — the
reasoning just was not extended to the rest.

**Fix:** `uv lock` (or `pip-compile`) committed, and `--frozen`/`--require-hashes`
in CI. Add `pip-audit` to the sidecar job while you are there; `pnpm audit`
already runs on the other side and reports clean.

---

# S-5 · Redirects bypass the art proxy's allowlist `MEDIUM`

**OWASP:** server-side request forgery.

Full detail in [EXPOSURE.md](EXPOSURE.md) as **E-8** — `fetch` defaults to
`redirect: "follow"`, and the host allowlist is applied only to the URL supplied,
never to where a redirect lands. Repeated here because it is the only genuine
SSRF-shaped issue in the codebase and belongs in a security index.

Also in that file and relevant here: **E-7** (`/api/art` has no rate limit at
all), **E-14** (no CSP or other security headers — A02:2025 Security
Misconfiguration), **E-11** (no secret rotation path — A07:2025 Authentication
Failures), and **E-12** (the sidecar logs no authentication failures —
A09:2025 Logging and Alerting Failures).

---

# S-6 · The same missing validation exists on the storage path `LOW`

**OWASP:** A06:2025 Insecure Design.

`readStorage` (`store.ts:74-96`) checks `id`, `name` and `Array.isArray(songs)`,
then repairs timestamps — careful work, and it stops one element short. It is the
same gap as S-1 reached by a different route, which is why the fix has to be
applied in both places and not just at the import.

Recorded separately so that fixing the import does not read as closing the class.

---

# Verified correct — do not re-investigate

Each of these is a place a vulnerability would normally be, and is not.

| Area | Finding | How it was checked |
|---|---|---|
| **DOM XSS** | Exactly one `dangerouslySetInnerHTML` (`app/layout.tsx:246`), and it renders a module constant with no interpolation of any kind. **No `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` anywhere** in `apps/web` or `packages`. | grep across all `.ts`/`.tsx` |
| **postMessage** | **No `message` listeners and no `postMessage` calls in the entire codebase.** For an app built around two third-party iframe players, this is the single most likely XSS hole and it is absent — the vendor SDKs own that channel and Timbre never opens its own. | grep across all `.ts`/`.tsx` |
| **SSRF via `/api/resolve`** | The user's URL is never fetched. The YouTube path posts it to the sidecar, which regex-extracts an 11-character video id against a host allowlist (`routes/search.py:139-166`) and only ever calls `get_song(id)`. The SoundCloud path gates on `isSoundCloudUrl` and then passes the URL as a *query parameter* to a fixed oEmbed endpoint. Neither reaches an attacker-chosen host. | read both providers end to end |
| **Hostile artwork URLs** | Every cover renders through `<Artwork>`, which always calls `proxied()` — so an imported `artworkUrl` pointing at an attacker's host goes to `/api/art`, fails the allowlist, 403s, and falls back to the placeholder. Non-HTTPS URLs pass through unproxied, but `javascript:` cannot execute in `img src` and `http:` is blocked as mixed content on an HTTPS deployment. | read `artwork.tsx` + `artwork-url.ts` |
| **Prototype pollution** | The import spreads parsed JSON (`{...playlist}`). Object spread uses `CreateDataProperty`, so a `__proto__` key becomes an ordinary own property rather than mutating the prototype. Not exploitable. | language semantics + read |
| **ReDoS** | No nested-quantifier patterns in any regex in `core`, `providers`, `lib` or `app`. The LRC timestamp parser — the one regex applied to untrusted upstream text on the server — is `\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]`, linear. | pattern scan across the tree |
| **JS dependencies** | `pnpm audit` — **no known vulnerabilities**, at every severity level. | ran it |
| **Secrets in history** | `.env` has never been committed on any branch. Every commit matching `YTMUSIC_SHARED_SECRET=` is `.env.example`, documentation, or the CI placeholder `ci-placeholder`. | `git log --all` pickaxe |
| **Timing attacks** | `hmac.compare_digest` on the shared secret (`security.py:20`). Correct. | read |
| **Input bounds** | Enforced at both edges. Pydantic: query ≤ 500 chars, `limit` 1–50, `video_id` regex-pinned, URL ≤ 2000. Zod on every web route: same shape. Profile images are capped at 25 MB (5 MB animated) before decode. | read `models.py`, all 8 routes, `image-resize.ts` |
| **Error disclosure** | The sidecar maps every upstream failure to a flat `502 "YouTube Music <action> failed."` and logs the detail server-side rather than returning it (`errors.py:14-22`). No stack traces, no upstream text, no version. FastAPI's `/docs`, `/redoc` and `/openapi.json` are all explicitly disabled. | read `errors.py`, `main.py` |
| **Access control & CSRF** | Largely inapplicable **by design**, and that is worth stating: there are no accounts, no sessions, no server-side user state, and no authenticated state-changing endpoint. Every mutation happens in the visitor's own browser against their own storage. There is nothing for a forged cross-site request to accomplish. | architecture |

---

# What to fix, in order

1. **S-1** — validate song elements in both `importPlaylists` and `readStorage`,
   and persist after computing state. Proven bug, permanent damage, small fix.
2. **S-2** — add `app/global-error.tsx` with a data-reset action. Cheapest
   resilience available, and it is S-1's missing recovery path.
3. **S-3** — SHA-pin the actions in `release.yml` first, then `ci.yml`.
4. **S-4** — commit a Python lockfile; add `pip-audit` to the sidecar job.
5. **S-5** — `redirect: "manual"` in `/api/art`, re-validating each hop.
6. Then the cross-referenced EXPOSURE items: **E-7**, **E-14**, **E-11**.

## Sources

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) — the edition used for the
  mapping above; note A02 is now Security Misconfiguration and A03 is Software
  Supply Chain Failures, both of which moved since 2021
- [OWASP Top 10 project](https://owasp.org/www-project-top-ten/)
- [OWASP vulnerability index](https://owasp.org/www-community/vulnerabilities/)
