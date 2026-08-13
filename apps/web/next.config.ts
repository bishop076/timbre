import type { NextConfig } from "next";

import pkg from "./package.json" with { type: "json" };

/**
 * What build this is, for the corner of the settings panel.
 *
 * Read here rather than imported into a component: `package.json` is not
 * something a client bundle should be pulling in — it would carry every
 * dependency name and script into the browser to retrieve one string.
 *
 * The commit comes from whatever the host exposes and is simply absent
 * otherwise, which is the honest answer in development: a local tree usually
 * has changes that belong to no commit at all, so naming one would be a lie
 * about what is running.
 *
 * `GITHUB_SHA` is in the chain because GitHub Actions sets it in every step,
 * which is what makes the version in the settings panel name the commit that is
 * actually on GitHub. Without it a CI build advertised a bare `v0.1.0` — true,
 * but not enough to tell two builds of the same version apart, which is the only
 * job the string has.
 */
const COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "";

const nextConfig: NextConfig = {
  /**
   * Where the build output goes.
   *
   * Overridable so a production build can be measured **without stopping the dev
   * server**, which owns `.next` and serves stale or half-written chunks if a
   * build lands in it underneath. `TIMBRE_DIST_DIR=.next-prod pnpm build` puts it
   * somewhere harmless; unset, nothing changes.
   */
  distDir: process.env.TIMBRE_DIST_DIR ?? ".next",

  env: {
    NEXT_PUBLIC_TIMBRE_VERSION: pkg.version,
    NEXT_PUBLIC_TIMBRE_COMMIT: COMMIT.slice(0, 9),
  },

  // Workspace packages ship as TypeScript source with no build step, so Next
  // compiles them itself.
  transpilePackages: ["@timbre/core", "@timbre/providers"],

  // Next's dev-only route indicator sits bottom-left, which is exactly where
  // the player bar's artwork is — it covered the cover of whatever was
  // playing. It never appears in a production build, so this only affects
  // development. Compile and runtime errors are still surfaced.
  devIndicators: false,

  /**
   * The one route whose HTML is about a particular person.
   *
   * `/profile` renders the display name out of the `timbre-name` cookie, which
   * makes it the only response in the app that differs between readers. Next
   * already marks a cookie-reading route uncacheable, so this changes nothing
   * about how it behaves today — it is here because the *consequence* of
   * getting it wrong is a shared cache handing one person's name to another,
   * and that is too sharp an edge to leave resting on a framework default that
   * nothing in this repo asserts.
   *
   * `Vary: Cookie` states the actual dependency for any intermediary that
   * caches despite `no-store`. `private` says the same thing to the ones that
   * only read that.
   */
  headers() {
    return [
      {
        source: "/profile",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0, must-revalidate" },
          { key: "Vary", value: "Cookie" },
        ],
      },
    ];
  },
};

export default nextConfig;
