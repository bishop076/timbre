"use client";

import { useState } from "react";

import { beginConnect, saveSpotifyClientId, spotifyClientId } from "./connection.ts";
import { disconnectSpotify, useSpotifyTokens } from "./token-store.ts";

/**
 * Connect or disconnect Spotify.
 *
 * **The client id field is not a nicety.** Spotify allows five users per app, so a copy of
 * Timbre cannot usefully ship one — anyone running their own registers their own app, and
 * asking them to rebuild to supply the id would be the same barrier in a smaller form. A
 * client id is public by design; PKCE is what makes shipping one without a secret safe.
 */
export function SpotifyConnect() {
  const tokens = useSpotifyTokens();
  const [clientId, setClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const connected = Boolean(tokens);
  const configured = typeof window !== "undefined" && Boolean(spotifyClientId());

  async function connect() {
    setBusy(true);
    setError(null);
    if (clientId.trim()) saveSpotifyClientId(clientId);
    const reason = await beginConnect();
    if (reason) {
      setError(reason);
      setBusy(false);
    }
    // On success the browser is already navigating to Spotify; leaving `busy` set keeps the
    // button from being pressed twice during the redirect.
  }

  return (
    <section className="slab-sm rounded-[var(--r-md)] bg-[var(--surface-2)] p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">Spotify</h3>

      <p className="mt-1.5 text-sm text-[var(--fg-dim)]">
        {connected
          ? "Search shows a Spotify section, using your own account. Tracks play in Spotify\u2019s own player."
          : "Connect your own Spotify account to search its catalogue. Timbre never sees the token \u2014 it stays in this browser."}
      </p>

      {!connected && !configured && (
        <label className="mt-2.5 block">
          <span className="text-xs text-[var(--fg-faint)]">
            Client id from your Spotify app (developer.spotify.com)
          </span>
          <input
            type="text"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            placeholder="e.g. 4f2c1b9d8e7a4c3b9f0e1d2c3b4a5968"
            className="mt-1 w-full rounded-[var(--r-sm)] bg-[var(--surface-1)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </label>
      )}

      {error && <p className="mt-2 text-xs text-amber-500">{error}</p>}

      <div className="mt-2.5 flex gap-2">
        {connected ? (
          <button
            type="button"
            onClick={() => disconnectSpotify()}
            className="press rounded-[var(--r-sm)] bg-[var(--surface-3)] px-3 py-1.5 text-sm font-medium text-[var(--fg)]"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy}
            className="press rounded-[var(--r-sm)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--on-accent,#0b0b0d)] disabled:opacity-60"
          >
            {busy ? "Opening Spotify\u2026" : "Connect Spotify"}
          </button>
        )}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[var(--fg-faint)]">
        Spotify allows five users per app and requires the app owner to hold Premium. Its
        tracks stay in their own section and play in Spotify&rsquo;s player, never in
        Timbre&rsquo;s queue.
      </p>
    </section>
  );
}
