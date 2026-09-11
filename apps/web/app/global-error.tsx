"use client";

function ownedKeys(): string[] {
  return Object.keys(localStorage).filter((key) => key.startsWith("timbre:"));
}

function download(): void {
  try {
    const dump = Object.fromEntries(
      ownedKeys()
        .filter((key) => !key.startsWith("timbre:spotify"))
        .map((key) => [key, localStorage.getItem(key)]),
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "timbre-storage-backup.json";
    link.click();
    URL.revokeObjectURL(url);
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
