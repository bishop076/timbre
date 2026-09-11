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

const YOUTUBE = "https://www.youtube.com";
const YOUTUBE_NOCOOKIE = "https://www.youtube-nocookie.com";
const SOUNDCLOUD = "https://w.soundcloud.com";
const SPOTIFY = "https://open.spotify.com";
const SPOTIFY_SDK = "https://sdk.scdn.co";
const MIXCLOUD = "https://player-widget.mixcloud.com https://widget.mixcloud.com";

const IN_PRODUCTION = process.env.NODE_ENV === "production";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${YOUTUBE} ${SOUNDCLOUD} ${MIXCLOUD} ${SPOTIFY} ${SPOTIFY_SDK}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `frame-src ${YOUTUBE} ${YOUTUBE_NOCOOKIE} ${SOUNDCLOUD} ${SPOTIFY} ${SPOTIFY_SDK} ${MIXCLOUD}`,
  "media-src 'self' https: blob:",
  "connect-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
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

  { key: "Content-Security-Policy-Report-Only", value: CONTENT_SECURITY_POLICY },
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
