"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { completeConnect } from "../connection.ts";

/**
 * Where Spotify sends the reader back to.
 *
 * A page rather than a route handler because the exchange happens in the browser: the
 * verifier is in this tab's `sessionStorage` and the token must never reach the server.
 * Nothing is rendered from the query string, so the code and state cannot be echoed back
 * into the document.
 */
export default function SpotifyCallback() {
  const [state, setState] = useState<{ done: boolean; error: string | null }>({
    done: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    // Read from `location` rather than `useSearchParams`, which would force this route to
    // opt out of static rendering for a value only the browser ever has.
    void completeConnect(new URLSearchParams(window.location.search)).then((error) => {
      if (cancelled) return;
      setState({ done: true, error });
      // Drop the code from the address bar either way: it is single-use and spent, and it
      // has no business surviving in history or in a shared URL.
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
