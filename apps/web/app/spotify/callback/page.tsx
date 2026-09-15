"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { completeConnect, type ConnectFailure } from "../connection.ts";

/**
 * One document, one redirect: `beginConnect` leaves the page entirely, so this module is
 * evaluated fresh every time a callback actually arrives. That makes a single module-scope
 * promise enough to survive React running the effect twice, with nothing to key it on and
 * nothing left holding the authorization code afterwards.
 */
let attempt: Promise<ConnectFailure | null> | null = null;

function scrub(): void {
  window.history.replaceState(null, "", "/spotify/callback");
}

function exchangeOnce(): Promise<ConnectFailure | null> {
  if (attempt) return attempt;

  const params = new URLSearchParams(window.location.search);
  // Scrubbed *before* the exchange as well as after it. While `?code=…` sits in the address bar
  // it is in this history entry and in the `Referer` of anything this page goes on to request,
  // and a token exchange that hangs — offline, or a blocker holding accounts.spotify.com — used
  // to leave it there indefinitely, because the only `replaceState` was on the far side of the
  // await. Reading `params` first is what makes stripping it this early safe.
  //
  // This first call is best-effort and measurably so: a `replaceState` during hydration loses a
  // race with the App Router restoring the URL it rendered, which is why the caller repeats it
  // once the outcome lands. Observed on a cold page, where compilation pushes hydration past the
  // effect; on a warm one the early call sticks by itself.
  scrub();

  attempt = completeConnect(params);
  return attempt;
}

export default function SpotifyCallback() {
  const [outcome, setOutcome] = useState<{ failure: ConnectFailure | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void exchangeOnce().then((failure) => {
      scrub();
      if (!cancelled) setOutcome({ failure });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const failure = outcome?.failure ?? null;

  return (
    <main className="mx-auto flex min-h-[70dvh] w-full max-w-lg flex-col justify-center px-5 py-10">
      <div className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-6 py-7">
        {!outcome ? (
          <>
            <Dot className="bg-[var(--fg-faint)]" pulse />
            <h1 className="mt-3 text-[length:var(--text-title)] font-extrabold tracking-tight">
              Connecting to Spotify…
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fg-dim)]">
              Trading the sign-in for a token. It never leaves this browser.
            </p>
          </>
        ) : failure ? (
          <>
            <Dot className="bg-[var(--warn)]" />
            <h1 className="mt-3 text-[length:var(--text-title)] font-extrabold tracking-tight">
              {failure.title}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fg-dim)]">{failure.detail}</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--fg-faint)]">
              Nothing was saved: this sign-in stored no token, and left any connection you already
              had exactly as it was.
            </p>
            <Actions
              primary={
                failure.retry
                  ? { href: "/profile", label: "Try connecting again" }
                  : { href: "/profile", label: "Open Settings" }
              }
            />
          </>
        ) : (
          <>
            <Dot className="bg-[var(--accent)]" />
            <h1 className="mt-3 text-[length:var(--text-title)] font-extrabold tracking-tight">
              Spotify connected
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[var(--fg-dim)]">
              Search now carries a Spotify section drawn from your own account, and — if that
              account is Premium — tracks play here in full instead of stopping at Spotify&rsquo;s
              30-second preview.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--fg-faint)]">
              The token is held in this browser only. Timbre has no server to send it to, and
              Disconnect in Settings erases it.
            </p>
            <Actions primary={{ href: "/search", label: "Back to search" }} />
          </>
        )}
      </div>
    </main>
  );
}

function Dot({ className, pulse = false }: { className: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`block size-2.5 rounded-[var(--r-full)] ${className} ${pulse ? "animate-pulse" : ""}`}
    />
  );
}

function Actions({ primary }: { primary: { href: string; label: string } }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <Link
        href={primary.href}
        className="press rounded-[var(--r-md)] bg-[var(--accent)] px-3.5 py-2 text-[13px] font-bold text-[var(--accent-fg)]"
      >
        {primary.label}
      </Link>
      <Link
        href="/"
        className="press rounded-[var(--r-md)] bg-[var(--surface-3)] px-3.5 py-2 text-[13px] font-bold text-[var(--fg-dim)] transition hover:text-[var(--fg)]"
      >
        Home
      </Link>
    </div>
  );
}
