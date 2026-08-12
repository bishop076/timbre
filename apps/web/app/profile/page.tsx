import { cookies } from "next/headers";

import { ProfileView } from "./profile-view";

export const metadata = { title: "Your profile — Timbre" };

/**
 * Your profile.
 *
 * **The one thing the server can know about you, it now reads.** Everything
 * here lives in the reader's browser, so this page used to render the empty
 * profile and let the client correct it — which meant a stranger called
 * "Profile" on screen for a frame on every reload.
 *
 * The name comes up in a cookie (see `local-profile.ts`), which is the only
 * local value a browser volunteers with the request. So the first byte of HTML
 * can carry the right name, and there is no guest frame to correct.
 *
 * Nothing is stored here. The browser states its name, this render uses it, and
 * it is forgotten — there is still no account, no session and no record.
 *
 * Reading a cookie makes the route dynamic, which is correct: a page whose
 * content depends on the request must not be cached and handed to someone else.
 */
/**
 * The cookie, decoded without trusting it.
 *
 * `decodeURIComponent` **throws** on a malformed escape — a bare `%` is enough —
 * and a cookie is client-supplied data that also outlives the code that wrote
 * it. Unguarded, one bad value turned this page into a 500 with no way for the
 * reader to clear it, since the page that would have let them is the page that
 * was failing. The name is a nicety; falling back to none costs one frame.
 */
function readName(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw) || null;
  } catch {
    return null;
  }
}

export default async function ProfilePage() {
  const jar = await cookies();

  return <ProfileView serverName={readName(jar.get("timbre-name")?.value)} />;
}
