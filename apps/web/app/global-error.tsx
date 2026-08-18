"use client";

/**
 * The last boundary. Nothing catches what reaches here.
 *
 * Timbre reads five separate `localStorage` stores *during render*, through
 * `useSyncExternalStore` — so a record none of them can parse is not a broken page, it is a
 * throw in the render phase. The sidebar is mounted in the root layout, which puts that
 * throw above every route at once, and above a segment `error.tsx` too: only
 * `global-error` sits high enough to catch a root layout that will not render. That is why
 * this file exists rather than the more usual one. See docs/SECURITY.md, S-2.
 *
 * **It must not import from the rest of the app.** Every store, helper and component here
 * is a candidate for whatever went wrong, and a recovery screen that imports the thing it
 * is recovering from cannot render either. Plain DOM only, styles included: the boot
 * script lives in the layout this replaces, so none of the theme custom properties exist
 * by the time anyone reads this.
 */

/** Everything the app owns is namespaced. Matched by prefix rather than listed, so a store
 * added later is cleared too — a list here would drift the moment someone forgot it. */
const PREFIX = "timbre:";
const DB_NAME = "timbre";
const NAME_COOKIE = "timbre-name";

function ownedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/**
 * A copy of everything, before anything is destroyed.
 *
 * The reason this button exists: the only recovery from a poisoned record used to be
 * clearing site data, which also deletes every playlist, the profile and the history — the
 * remedy destroyed exactly what it was meant to save. The values are written out **raw and
 * unparsed**, because whatever is in there is by definition something the app could not
 * read, and parsing it here would throw on the same record twice.
 */
function download(): void {
  try {
    const dump: Record<string, string | null> = {};
    for (const key of ownedKeys()) dump[key] = localStorage.getItem(key);

    const url = URL.createObjectURL(
      new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "timbre-storage-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  } catch {
    // Storage blocked, or no room to build the blob. The reset below still works, and
    // saying so is the caption's job — there is nowhere useful to report this.
  }
}

function reset(): void {
  try {
    for (const key of ownedKeys()) localStorage.removeItem(key);
  } catch {
    // Blocked. Carry on: the picture store and the cookie are separate, and clearing
    // what can be cleared is strictly better than stopping at the first refusal.
  }

  // Profile pictures live in IndexedDB rather than localStorage — blobs at their real size
  // instead of a third larger as base64 — so they need their own removal.
  try {
    indexedDB.deleteDatabase(DB_NAME);
  } catch {
    /* Not fatal: nothing renders a picture that is not there. */
  }

  // The display name is also a cookie, for the server's first paint. Left behind, the name
  // outlives the profile it belonged to.
  document.cookie = `${NAME_COOKIE}=;path=/;max-age=0;SameSite=Lax`;

  // A full document load, deliberately, and the one place `router.push` is the wrong tool:
  // every store caches its first read in module scope, so a soft navigation would carry the
  // same emptied-out snapshots — and the same broken React tree — straight into the next
  // screen. Throwing the process away is the point.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- see above
  location.href = "/";
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    // `global-error` replaces the root layout while it is active, so it owns these.
    <html lang="en">
      <body>
        <style>{`
          :root { color-scheme: dark light; }
          body {
            margin: 0; min-height: 100dvh;
            display: flex; align-items: center; justify-content: center;
            padding: 2rem;
            background: #0f0f14; color: #f4f3f8;
            font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          }
          @media (prefers-color-scheme: light) {
            body { background: #eceaf4; color: #17161d; }
          }
          .card { max-width: 34rem; }
          h1 { font-size: 1.4rem; margin: 0 0 .75rem; letter-spacing: -.01em; }
          p { margin: 0 0 1rem; opacity: .75; }
          .row { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.4rem; }
          button {
            font: inherit; font-size: .95rem; cursor: pointer;
            padding: .55rem 1rem; border-radius: .6rem;
            border: 1px solid currentColor; background: none; color: inherit;
          }
          button.primary { background: currentColor; border-color: transparent; }
          button.primary span { color: #0f0f14; }
          @media (prefers-color-scheme: light) {
            button.primary span { color: #eceaf4; }
          }
          code {
            font-family: ui-monospace, monospace; font-size: .8rem;
            opacity: .55; word-break: break-all;
          }
        `}</style>

        <main className="card">
          <h1>Timbre couldn&rsquo;t start.</h1>
          <p>
            Something in the app failed while rendering. Trying again is safe and costs
            nothing — most failures here are transient.
          </p>
          <p>
            If it keeps happening, one of the records saved in this browser is unreadable.
            Save a copy first: resetting clears your playlists, profile and listening
            history, and that file is the only way back.
          </p>

          <div className="row">
            <button className="primary" onClick={() => retry()}>
              <span>Try again</span>
            </button>
            <button onClick={download}>Save a copy of my data</button>
            <button
              onClick={() => {
                if (confirm("Clear Timbre's playlists, profile and history from this browser?")) {
                  reset();
                }
              }}
            >
              Reset stored data
            </button>
          </div>

          {error.digest ? (
            <p style={{ marginTop: "1.5rem" }}>
              <code>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
