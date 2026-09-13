import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";
import ts from "typescript";

import pkg from "./package.json" with { type: "json" };

function writeServiceWorker(): void {
  const source = path.join(__dirname, "sw", "sw.ts");
  const target = path.join(__dirname, "public", "sw.js");
  const { outputText } = ts.transpileModule(readFileSync(source, "utf8"), {
    fileName: source,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
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

const COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT ?? "";

// Every origin the top document loads a script from or frames. Verified against the code
// rather than guessed: the script hosts start at the `API_SRC`/`SDK_SRC` constants in
// app/player/*, and the frame hosts are the four `<iframe>` sites plus the players those
// SDKs inject for themselves. A constant is only where an origin starts, though — an API
// that is a loader adds a host the code never names, which is what the two below are.
const PLAYERS = [
  "https://www.youtube.com",
  "https://w.soundcloud.com",
  "https://player-widget.mixcloud.com",
  "https://widget.mixcloud.com",
  "https://open.spotify.com",
  "https://sdk.scdn.co",
].join(" ");

// SoundCloud's widget API pulls the rest of itself from these two. layout.tsx already
// preconnects to both, which is the evidence they are talked to from this document.
const SOUNDCLOUD_ASSETS = "https://widget.sndcdn.com https://api-widget.soundcloud.com";

// Spotify's embed API is a loader and nothing else: `open.spotify.com/embed/iframe-api/v1`
// injects one script from here, and *that* is what calls `onSpotifyIframeApiReady`. Naming
// only the loader let it through and blocked the bundle, so every Spotify-only track died at
// the 8s timeout in spotify-player.tsx with "No source here could play this one." Read off
// the loader's own response body, not guessed. The Web Playback SDK at sdk.scdn.co, and both
// Mixcloud APIs, were checked the same way and pull nothing beyond origins already named.
const SPOTIFY_EMBED_ASSETS = "https://embed-cdn.spotifycdn.com";

const IN_PRODUCTION = process.env.NODE_ENV === "production";

const REPORT_TO = "/api/csp-report";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // React's development build needs `eval` for its debugging features — reconstructing a
  // callstack from another environment, chiefly — so without this every dev page load logs
  // a CSP error and the overlay reports an issue. Production never calls `eval`.
  `script-src 'self' 'unsafe-inline'${IN_PRODUCTION ? "" : " 'unsafe-eval'"} ${PLAYERS} ${SOUNDCLOUD_ASSETS} ${SPOTIFY_EMBED_ASSETS}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `frame-src https://www.youtube-nocookie.com https://widget.deezer.com https://embed.music.apple.com ${PLAYERS}`,
  "media-src 'self' https: blob:",
  // Deliberately wide, and the next thing to narrow. The players reach hosts this document
  // cannot enumerate statically, so pinning it is a change that needs violation reports
  // behind it — which is what the two directives below now produce.
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${REPORT_TO}`,
  "report-to csp",
  ...(IN_PRODUCTION ? ["upgrade-insecure-requests"] : []),
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  ...(IN_PRODUCTION
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // `report-to` needs the group declared; `report-uri` in the policy covers the browsers
  // that never learned it.
  { key: "Reporting-Endpoints", value: `csp="${REPORT_TO}"` },
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
];

const nextConfig: NextConfig = {
  distDir: process.env.TIMBRE_DIST_DIR ?? ".next",
  env: {
    NEXT_PUBLIC_TIMBRE_VERSION: pkg.version,
    NEXT_PUBLIC_TIMBRE_COMMIT: COMMIT.slice(0, 9),
  },
  transpilePackages: ["@timbre/core", "@timbre/providers"],
  devIndicators: false,
  headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
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
