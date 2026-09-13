"use client";

function ownedKeys(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith("timbre:"));
}

/** The keys the envelope below lifts into named fields, so they are not repeated under `storage`. */
const CARRIED = new Set(["timbre:playlists", "timbre:likes", "timbre:history", "timbre:plays"]);

function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/**
 * The escape hatch on the crash screen, and the copy below calls the file it writes the only
 * way back — so it has to be a file the app can actually read back. It used to dump raw
 * localStorage keyed by name (`{"timbre:playlists": "<json string>", …}`), a shape both
 * `importPlaylists` and `readProfileExport` reject out of hand. Write the same
 * `timbre.playlists` v3 envelope the Export menu writes, and carry the unrecognised keys
 * alongside under `storage` so nothing is lost even though the importer ignores them.
 *
 * Spotify's tokens stay out of it, as they always did.
 */
function backupFile(): string {
  const rest: Record<string, string | null> = {};
  for (const key of ownedKeys()) {
    if (key.startsWith("timbre:spotify")) continue;
    if (!CARRIED.has(key)) rest[key] = localStorage.getItem(key);
  }

  return JSON.stringify(
    {
      format: "timbre.playlists",
      version: 3,
      exportedAt: new Date().toISOString(),
      playlists: readJson("timbre:playlists") ?? [],
      liked: readJson("timbre:likes") ?? [],
      history: readJson("timbre:history") ?? [],
      plays: readJson("timbre:plays"),
      storage: rest,
    },
    null,
    2,
  );
}

/**
 * Not appended to the document and revoked in the same tick, this silently did nothing at all
 * in Firefox — on the one screen whose whole purpose is rescuing data before a reset.
 * `playlists/export-menu.tsx` has had the right idiom the whole time; this is it.
 */
function download(): void {
  try {
    const url = URL.createObjectURL(new Blob([backupFile()], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `timbre-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {}
}

function reset(): void {
  if (!confirm("Clear Timbre's playlists, profile and history from this browser?")) return;
  try {
    for (const key of ownedKeys()) localStorage.removeItem(key);
  } catch {}
  try {
    indexedDB.deleteDatabase("timbre");
  } catch {}
  document.cookie = "timbre-name=;path=/;max-age=0;SameSite=Lax";
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
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
          code {
            font-family: ui-monospace, monospace; font-size: .8rem;
            opacity: .55; word-break: break-all;
          }
          @media (prefers-color-scheme: light) {
            body { background: #eceaf4; color: #17161d; }
            button.primary span { color: #eceaf4; }
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
            <button onClick={reset}>Reset stored data</button>
          </div>

          {error.digest && (
            <p style={{ marginTop: "1.5rem" }}>
              <code>{error.digest}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
