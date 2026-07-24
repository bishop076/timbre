import { auth } from "@/auth";

/**
 * Route protection.
 *
 * Timbre is deliberately usable without an account: searching and playing
 * require no sign-in, because the whole point is that someone can open a link
 * and listen. Only routes holding a user's own data are gated.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`; the named export
 * must be `proxy`. Unlike middleware, `proxy` always runs on the Node.js
 * runtime, which removes the split config Auth.js v5 normally needs to keep
 * the database adapter out of an edge bundle.
 */
export const proxy = auth;

export const config = {
  matcher: ["/playlists/:path*", "/settings/:path*"],
};
