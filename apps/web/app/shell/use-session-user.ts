"use client";

import { useEffect, useState } from "react";

/**
 * Who is signed in, if anyone.
 *
 * Read from Auth.js's own `/api/auth/session`, which the `[...nextauth]`
 * handler already serves — no new route, and no `SessionProvider` wrapped
 * around the whole tree for one label. It answers `null` when signed out,
 * which is why the fetch never needs to distinguish an error from a guest.
 *
 * Timbre is deliberately usable without an account, so a guest is the normal
 * case rather than a failure: everything here degrades to "no name, no
 * picture" and the shell simply shows less.
 */
export interface SessionUser {
  name: string | null;
  image: string | null;
}

interface SessionResponse {
  user?: { name?: string | null; image?: string | null } | null;
}

export function useSessionUser(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const aborter = new AbortController();

    fetch("/api/auth/session", { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SessionResponse | null>) : null))
      .then((data) => {
        const found = data?.user;
        if (found) setUser({ name: found.name ?? null, image: found.image ?? null });
      })
      .catch(() => {
        // Signed out, offline, or auth not configured. All three mean "guest",
        // and none of them are worth telling anyone about.
      });

    return () => aborter.abort();
  }, []);

  return user;
}
