import type { NextConfig } from "next";

import pkg from "./package.json" with { type: "json" };

// What build this is, for the settings panel. Read here rather than imported into a
// component, which would carry every dependency name into the browser for one string.
// `GITHUB_SHA` is in the chain because Actions sets it in every step; without it a CI build
// advertised a bare `v0.1.0`, which cannot tell two builds apart.
const COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "";

const nextConfig: NextConfig = {
  /** Overridable so a production build can be measured without stopping the dev server,
   * which owns `.next` and serves half-written chunks if a build lands in it underneath. */
  distDir: process.env.TIMBRE_DIST_DIR ?? ".next",

  env: {
    NEXT_PUBLIC_TIMBRE_VERSION: pkg.version,
    NEXT_PUBLIC_TIMBRE_COMMIT: COMMIT.slice(0, 9),
  },

  // Workspace packages ship as TypeScript source, so Next compiles them itself.
  transpilePackages: ["@timbre/core", "@timbre/providers"],

  // The dev-only route indicator sits bottom-left, over the player bar's artwork.
  devIndicators: false,

  // `/profile` is the one response that differs between readers — it renders the display
  // name out of the `timbre-name` cookie. Next already marks a cookie-reading route
  // uncacheable; this asserts it rather than resting on a framework default, because
  // getting it wrong means a shared cache handing one person's name to another.
  // `Vary: Cookie` states the dependency for anything that caches despite `no-store`, and
  // `private` says it to whatever only reads that.
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
