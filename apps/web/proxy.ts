import { auth } from "@/auth";

/**
 * Route protection.
 *
 * Next.js 16 renamed the `middleware` convention to `proxy`; the named export
 * must be `proxy`. Unlike middleware, `proxy` always runs on the Node.js
 * runtime, which is a real simplification here — Auth.js v5 normally needs a
 * split config to keep the database adapter out of the edge bundle, and that
 * is unnecessary now.
 */
export const proxy = auth;

export const config = {
  // Everything except Next internals, the auth endpoints themselves, the
  // health probe, and static assets.
  matcher: ["/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)"],
};
