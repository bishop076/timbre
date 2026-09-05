import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";
import ts from "typescript";

import pkg from "./package.json" with { type: "json" };

/**
 * Writes `public/sw.js` from `sw/sw.ts`.
 *
 * A service worker is fetched by URL as a plain script, so the file the browser gets
 * cannot be TypeScript. It used to be hand-written JavaScript in `public/`; now the
 * source is typed and this is the transpile. It runs here, at config load, rather than
 * in a `build` script because this is the one place every way of starting Next passes
 * through: `pnpm dev`, `pnpm build`, the Dockerfile's bare `next build`, and Vercel,
 * which may run `next build` directly rather than the package script. A step that only
 * ran in some of those would ship a deployment with a 404 where the worker should be.
 *
 * Strip-only — no type checking, so this is a few milliseconds. Types are checked by
 * `tsc -p sw` in `pnpm typecheck`, where a mistake fails the build loudly instead of
 * being quietly emitted. The output is git-ignored; edit `sw/sw.ts`, never `sw.js`.
 *
 * Not re-run on edit under `next dev`. It does not need to be: the worker is only
 * registered in production builds (see `app/service-worker.tsx`), so a dev session never
 * runs it, and the next `next dev` or `next build` regenerates it anyway.
 *
 * `__dirname` rather than `process.cwd()`: Next compiles this file to CommonJS and
 * requires it from `apps/web`, so `__dirname` is this directory whatever the shell's cwd
 * was — and `next build apps/web` from the repo root is a real thing to type.
 */
function writeServiceWorker(): void {
  const source = path.join(__dirname, "sw", "sw.ts");
  const target = path.join(__dirname, "public", "sw.js");
  const { outputText } = ts.transpileModule(readFileSync(source, "utf8"), {
    fileName: source,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      // The worker is a classic script with no imports, so this only names a syntax;
      // nothing module-shaped is emitted.
      module: ts.ModuleKind.ESNext,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    `// Generated from sw/sw.ts by next.config.ts. Do not edit; edit the source.\n${outputText}`,
  );
}

writeServiceWorker();

// What build this is, for the settings panel. Read here rather than imported into a
// component, which would carry every dependency name into the browser for one string.
// `GITHUB_SHA` is in the chain because Actions sets it in every step; without it a CI build
// advertised a bare `v0.1.0`, which cannot tell two builds apart.
const COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "";

/*
 * The two origins Timbre loads code from, besides itself. Both are player SDKs — see
 * `app/player/youtube-player.tsx` and `soundcloud-player.tsx`. Nothing else is external:
 * fonts are self-hosted by `next/font` at build time and artwork comes through `/api/art`.
 */
const YOUTUBE = "https://www.youtube.com";
/** Where the player iframe itself points — `PLAYER_HOST` in `youtube-player.tsx`, and the
 * reason is there. The IFrame API script still comes from www.youtube.com. */
const YOUTUBE_NOCOOKIE = "https://www.youtube-nocookie.com";
const SOUNDCLOUD = "https://w.soundcloud.com";
/** Spotify's embed is an iframe and nothing else — there is no script and no API. */
/** Spotify needs three hosts, and they do different jobs.
 *
 * `open.spotify.com` serves both the embed iframe *and* the script that drives it, so it
 * belongs in `script-src` as well as `frame-src` — the embed API is fetched from there, not
 * from a CDN. `sdk.scdn.co` is the Web Playback SDK: a script, plus an iframe it creates for
 * itself to hold the EME session.
 *
 * **Report-Only earned its keep here.** Both were missing, and adding the SDK reported
 * exactly two violations — script and frame — before anything was enforced. Had the policy
 * been switched on first, full-length Spotify playback would have failed with no error a
 * reader could act on. */
const SPOTIFY = "https://open.spotify.com";
const SPOTIFY_SDK = "https://sdk.scdn.co";
/** Mixcloud splits the two: the widget frame and the script that adopts it. */
const MIXCLOUD = "https://player-widget.mixcloud.com https://widget.mixcloud.com";

/**
 * Reported, not enforced — deliberately, and this is meant to be flipped.
 *
 * `script-src` cannot be made strict here without giving something up. Next inlines its own
 * bootstrap and streaming payload into the HTML, and those scripts differ per page, so no
 * fixed set of hashes in this file can cover them. The documented answer is a per-request
 * nonce, and the Next guide is explicit that a nonce **requires dynamic rendering** — which
 * would throw away the prerendering that makes this deployment free. So `'unsafe-inline'`
 * stays, and what this policy actually buys is the *other* directives: no plugins, no base
 * tag rewriting, no form posting off-site, and no script from an origin not listed above.
 *
 * Report-Only because it cannot be verified without a browser: a wrong `frame-src` or
 * `connect-src` breaks playback silently, and a broken player is worse than a missing
 * header. Open the console on a page that plays something, on a page with an avatar, and
 * on Explore. If nothing is reported, rename the key to `Content-Security-Policy`.
 *
 * Clickjacking is **not** waiting on that: `X-Frame-Options` below is enforced today and
 * covers what `frame-ancestors` would.
 */
/*
 * Development is served over plain http, and two of the directives below are not merely
 * useless there — they are actively destructive. See `SECURITY_HEADERS`.
 */
const IN_PRODUCTION = process.env.NODE_ENV === "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${YOUTUBE} ${SOUNDCLOUD} ${MIXCLOUD} ${SPOTIFY} ${SPOTIFY_SDK}`,
  // Tailwind's arbitrary values and the pre-paint boot script both write inline styles.
  "style-src 'self' 'unsafe-inline'",
  // `data:` and `blob:` are the profile pictures, which live in IndexedDB and are drawn
  // from object URLs. `https:` covers the artwork that `proxied()` passes through untouched.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `frame-src ${YOUTUBE} ${YOUTUBE_NOCOOKIE} ${SOUNDCLOUD} ${SPOTIFY} ${SPOTIFY_SDK} ${MIXCLOUD}`,
  // Audius is the one source Timbre plays itself, so its audio is fetched by an <audio>
  // element on this origin rather than inside someone's iframe. Without this it falls back
  // to `default-src 'self'` and every Audius track fails silently. `https:` rather than a
  // host list because `/stream` 302s to whichever content node holds the track, and that
  // set is operator-run and changes.
  "media-src 'self' https: blob:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Production only. On a dev server every request is http by definition, so this either
  // does nothing or rewrites the dev server's own URLs to a port that is not listening.
  ...(IN_PRODUCTION ? ["upgrade-insecure-requests"] : []),
].join("; ");

/**
 * Applied to every response. Each of these was simply absent — the only headers this app
 * set were the two cache directives on `/profile`. See docs/EXPOSURE.md, E-14.
 */
const SECURITY_HEADERS = [
  // Timbre is never framed by anyone, and a framed copy is a clickjack: the player bar and
  // the playlist menus are one click each, with no confirmation behind them.
  { key: "X-Frame-Options", value: "DENY" },

  // Referrers carried the full URL to every third party the page touched.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Already set by hand on `/api/art`; there is no reason for it to be the only route.
  { key: "X-Content-Type-Options", value: "nosniff" },

  /*
   * Two years — and **production only**, which is not tidiness. Sending this from the dev
   * server breaks development, persistently, and it took a report to find:
   *
   * `http://localhost` is a *potentially trustworthy origin*, so a browser does not
   * discard an HSTS policy served over it the way the RFC says to for plain http. It
   * records one — for the bare host `localhost`, with no port — and from then on upgrades
   * every `http://localhost` request to `https://localhost`, where nothing is listening.
   * That breaks this dev server, **every other project on the machine**, and it keeps
   * breaking them for two years after the header stops being sent, because the policy now
   * lives in the browser rather than in this file.
   *
   * `http://127.0.0.1` is unaffected: HSTS does not apply to IP literals. That asymmetry
   * is the tell — curl to 127.0.0.1 succeeding while a browser on localhost cannot connect
   * is this bug and nothing else.
   *
   * **No `preload`** either: that directive is an application to a browser-shipped list,
   * and getting off it takes months — not something to opt into from a config file on a
   * domain that may still change.
   */
  ...(IN_PRODUCTION
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),

  // Only what Timbre demonstrably never uses. `autoplay`, `fullscreen`, `accelerometer`
  // and `gyroscope` are deliberately left alone: the first two are how the players work,
  // and the last two are how YouTube serves 360° video.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },

  { key: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY },
];

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
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
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
