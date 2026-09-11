"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { completeConnect } from "../connection.ts";

const exchanges = new Map<string, Promise<string | null>>();

function exchangeOnce(search: string): Promise<string | null> {
  let pending = exchanges.get(search);
  if (!pending) {
    pending = completeConnect(new URLSearchParams(search));
    exchanges.set(search, pending);
  }
  return pending;
}

export default function SpotifyCallback() {
  const [state, setState] = useState<{ done: boolean; error: string | null }>({
    done: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    void exchangeOnce(window.location.search).then((error) => {
      if (cancelled) return;
      setState({ done: true, error });
      window.history.replaceState(null, "", "/spotify/callback");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold text-[var(--fg)]">
        {!state.done ? "Connecting to Spotify…" : state.error ? "Spotify could not connect" : "Connected to Spotify"}
      </h1>

      {state.done && (
        <p className="text-sm text-[var(--fg-dim)]">
          {state.error ?? "Search now includes a Spotify section, on your own account."}
        </p>
      )}

      {state.done && (
        <Link
          href="/search"
          className="slab-sm mx-auto rounded-[var(--r-md)] bg-[var(--surface-2)] px-4 py-2 text-sm font-medium text-[var(--fg)] transition hover:text-[var(--accent)]"
        >
          Back to search
        </Link>
      )}
    </main>
  );
}
