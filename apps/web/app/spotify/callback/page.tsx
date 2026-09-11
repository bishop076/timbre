"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { completeConnect } from "../connection.ts";

const exchanges = new Map<string, Promise<string | null>>();

function exchangeOnce(search: string): Promise<string | null> {
  const pending = exchanges.get(search) ?? completeConnect(new URLSearchParams(search));
  exchanges.set(search, pending);
  return pending;
}

export default function SpotifyCallback() {
  const [outcome, setOutcome] = useState<{ error: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void exchangeOnce(window.location.search).then((error) => {
      if (cancelled) return;
      setOutcome({ error });
      window.history.replaceState(null, "", "/spotify/callback");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-[var(--fg)]">
        {!outcome
          ? "Connecting to Spotify…"
          : outcome.error
            ? "Spotify could not connect"
            : "Connected to Spotify"}
      </h1>

      {outcome && (
        <>
          <p className="text-sm text-[var(--fg-dim)]">
            {outcome.error ?? "Search now includes a Spotify section, on your own account."}
          </p>
          <Link
            href="/search"
            className="slab-sm mx-auto rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--fg)] transition hover:text-[var(--accent)]"
          >
            Back to search
          </Link>
        </>
      )}
    </main>
  );
}
