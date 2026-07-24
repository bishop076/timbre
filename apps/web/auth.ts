import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { getDatabase, schema } from "@timbre/db";
import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";

import { getEnv, hasEmailAuth } from "@/lib/env";

/**
 * Timbre's own sign-in, kept strictly separate from music-service connections.
 *
 * Notably absent: Spotify as a login provider. It is the obvious choice for a
 * music app and the wrong one here — Spotify is a BYO connection a user may
 * never add or may disconnect, and losing your account because you unlinked a
 * music service would be indefensible.
 *
 * Database sessions rather than JWTs, because a revoked connection or a deleted
 * account has to take effect immediately, not at token expiry.
 *
 * The config is built lazily (Auth.js v5 accepts a function) so that importing
 * this module does not read the environment or open a connection pool. Without
 * that, `next build` would demand a database and a full set of secrets just to
 * collect page metadata.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const env = getEnv();

  return {
    adapter: DrizzleAdapter(getDatabase(), {
      usersTable: schema.users,
      accountsTable: schema.accounts,
      sessionsTable: schema.sessions,
      verificationTokensTable: schema.verificationTokens,
      authenticatorsTable: schema.authenticators,
    }),
    // No sign-in method is configured until SMTP is set; the sign-in page says
    // so rather than rendering a form that cannot work.
    providers: hasEmailAuth(env)
      ? [Nodemailer({ server: env.EMAIL_SERVER!, from: env.EMAIL_FROM! })]
      : [],
    session: { strategy: "database" as const },
    pages: { signIn: "/signin" },
    trustHost: true,
  };
});

/** Whether any sign-in method is configured. Safe to call at request time. */
export function isAuthConfigured(): boolean {
  return hasEmailAuth(getEnv());
}
