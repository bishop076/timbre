"use client";

import { useState } from "react";

import { CheckIcon } from "../icons";
import { Caption } from "../page-chrome";
import {
  beginConnect,
  looksLikeClientId,
  saveSpotifyClientId,
  useSpotifyClientId,
  useSpotifyRedirectUri,
  type ConnectFailure,
} from "./connection.ts";
import { disconnectSpotify, useSpotifyLapsed, useSpotifyTokens } from "./token-store.ts";

/** What connecting actually buys, and what it does not. Both halves are the honest part. */
const GAINS = [
  "Whole tracks instead of Spotify's 30-second preview — with Premium, through their Web Playback SDK.",
  "Search results from your own account's catalogue, in your own market.",
];

const LIMITS = [
  "A free Spotify account still only gets the 30-second preview. That is Spotify's rule and nothing here can lift it.",
  "Spotify tracks stay in their own section and play in Spotify's player. They never join Timbre's queue.",
];

type State = "connected" | "lapsed" | "fresh";

export function SpotifyConnect() {
  const connected = Boolean(useSpotifyTokens());
  const lapsed = useSpotifyLapsed();
  const [clientId, setClientId] = useState("");
  const [failure, setFailure] = useState<ConnectFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const configured = Boolean(useSpotifyClientId());
  const state: State = connected ? "connected" : lapsed ? "lapsed" : "fresh";

  async function connect() {
    setBusy(true);
    setFailure(null);
    const typed = clientId.trim();
    if (typed) saveSpotifyClientId(typed);
    const reason = await beginConnect();
    if (reason) {
      setFailure(reason);
      setBusy(false);
    }
    // No `else`: a clean start has already navigated away to accounts.spotify.com, and clearing
    // `busy` on the way out only flickers the button back to its resting label mid-unload.
  }

  return (
    <>
      <Caption>
        Timbre has no accounts of its own. Spotify is the one service it can sign you in to, and
        the sign-in is between your browser and Spotify — there is no server here to hold a token.
      </Caption>

      <section className="mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="text-[13px] font-bold">Spotify</h3>
          <Status state={state} />
        </div>

        <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">
          {state === "connected" ? (
            <>
              This browser holds a token for your Spotify account. Timbre never sees it: it goes
              straight from Spotify to here, and nothing is sent anywhere else.
            </>
          ) : state === "lapsed" ? (
            <>
              Spotify rejected the saved connection, so it was discarded rather than left in place
              pretending to work. A changed password, or removing Timbre under Apps in your Spotify
              account, both do this. Connecting again fixes it.
            </>
          ) : (
            <>
              Not connected. Spotify search still works without an account — what it cannot do is
              play a track past 30 seconds.
            </>
          )}
        </p>

        <List
          heading={state === "connected" ? "What this gives you" : "What connecting gives you"}
          items={GAINS}
          ticked={state === "connected"}
        />
        <List heading="What it still will not do" items={LIMITS} ticked={false} />

        {state !== "connected" && !configured && (
          <ClientIdField value={clientId} onChange={setClientId} />
        )}

        {failure && (
          <div role="alert" className="mt-3 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2.5">
            <p className="text-xs font-bold text-[var(--warn)]">{failure.title}</p>
            <p className="mt-1 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">
              {failure.detail}
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {state === "connected" ? (
            confirming ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    disconnectSpotify("asked");
                    setConfirming(false);
                  }}
                  className="press rounded-[var(--r-md)] bg-[var(--surface-3)] px-3.5 py-2 text-[12px] font-bold text-[var(--danger)]"
                >
                  Erase the token
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3.5 py-2 text-[12px] font-bold text-[var(--fg-dim)] transition hover:text-[var(--fg)]"
                >
                  Keep it
                </button>
                <span className="text-[11px] leading-snug text-[var(--fg-faint)]">
                  Search drops back to the public catalogue and playback to 30-second previews.
                </span>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3.5 py-2 text-[12px] font-bold text-[var(--fg)] transition hover:bg-[var(--surface-3)]"
              >
                Disconnect Spotify
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy}
              className="press rounded-[var(--r-md)] bg-[var(--accent)] px-3.5 py-2 text-[12px] font-bold text-[var(--accent-fg)] disabled:opacity-60"
            >
              {busy ? "Opening Spotify…" : state === "lapsed" ? "Reconnect Spotify" : "Connect Spotify"}
            </button>
          )}
        </div>
      </section>
    </>
  );
}

const TONE: Record<State, { label: string; dot: string; text: string }> = {
  connected: { label: "Connected", dot: "var(--accent)", text: "text-[var(--fg)]" },
  lapsed: { label: "Signed out by Spotify", dot: "var(--warn)", text: "text-[var(--fg-dim)]" },
  fresh: { label: "Not connected", dot: "var(--fg-faint)", text: "text-[var(--fg-dim)]" },
};

function Status({ state }: { state: State }) {
  const tone = TONE[state];
  return (
    <span
      className={`flex items-center gap-1.5 rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-bold ${tone.text}`}
    >
      <span
        aria-hidden="true"
        className="size-1.5 rounded-[var(--r-full)]"
        style={{ background: tone.dot }}
      />
      {tone.label}
    </span>
  );
}

function List({
  heading,
  items,
  ticked,
}: {
  heading: string;
  items: string[];
  ticked: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-faint)]">
        {heading}
      </p>
      <ul className="mt-1.5 max-w-prose space-y-1.5 text-xs leading-relaxed text-[var(--fg-dim)]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            {ticked ? (
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />
            ) : (
              <span aria-hidden="true" className="shrink-0 text-[var(--fg-faint)]">
                —
              </span>
            )}
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClientIdField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const redirectUri = useSpotifyRedirectUri();
  const typed = value.trim();
  const wrong = typed.length > 0 && !looksLikeClientId(typed);

  return (
    <div className="mt-4 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-3">
      <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-faint)]">
          Client id
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-[var(--fg-dim)]">
          From an app you register at developer.spotify.com. The public client id, never the client
          secret — a secret does not belong in a browser and Timbre does not ask for one.
        </span>
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={wrong}
          placeholder="4f2c1b9d8e7a4c3b9f0e1d2c3b4a5968"
          className="mt-2 w-full rounded-[var(--r-sm)] bg-[var(--surface-1)] px-2.5 py-1.5 font-mono text-xs text-[var(--fg)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        />
      </label>
      {wrong && (
        <p className="mt-1.5 text-[11px] text-[var(--warn)]">
          That is not the shape of a client id — one run of 32 letters and digits, nothing else.
        </p>
      )}
      <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--fg-faint)]">
        The app has to list this redirect URI, character for character:{" "}
        <code className="break-all font-mono text-[var(--fg-dim)]">{redirectUri}</code>
      </p>
    </div>
  );
}
