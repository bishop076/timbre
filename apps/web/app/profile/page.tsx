import { cookies } from "next/headers";

import { ProfileView } from "./profile-view";

export const metadata = { title: "Your profile — Timbre" };

/**
 * Your profile. Everything here lives in the reader's browser, so this page rendered the
 * empty profile and let the client correct it — a stranger called "Profile" on screen for a
 * frame on every reload. The name comes up in a cookie, the only local value a browser
 * volunteers with the request. Nothing is stored; reading a cookie makes the route dynamic.
 */
/** The cookie, decoded without trusting it: `decodeURIComponent` throws on a malformed
 * escape — a bare `%` — and unguarded, one bad value turned this page into a 500 with no
 * way for the reader to clear it, the page that would let them being the one failing. */
function readName(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    // Capped on the way in as well as on the way out. `setDisplayName` bounds what Timbre
    // writes, but a cookie is a value the client sends, so the writer is not the only thing
    // that can put one there — the same reason `playlists/store.ts` revalidates storage it
    // wrote itself. React escapes this either way; the cap is about size, not safety.
    return decodeURIComponent(raw).slice(0, 64) || null;
  } catch {
    return null;
  }
}

export default async function ProfilePage() {
  const jar = await cookies();

  return <ProfileView serverName={readName(jar.get("timbre-name")?.value)} />;
}
