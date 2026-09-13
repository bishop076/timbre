import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { PlayerProvider } from "./player/player-context";
import { ServiceWorker } from "./service-worker";
import { AppShell } from "./shell/app-shell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const DESCRIPTION = "Search YouTube Music, SoundCloud and more from one place.";
const SHARED = { title: "All your music, one search", description: DESCRIPTION };

export const metadata: Metadata = {
  title: "Timbre",
  description: DESCRIPTION,
  applicationName: "Timbre",
  openGraph: { type: "website", ...SHARED },
  twitter: { card: "summary_large_image", ...SHARED },
  appleWebApp: { capable: true, title: "Timbre", statusBarStyle: "black-translucent" },
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  ),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0f14" },
    { media: "(prefers-color-scheme: light)", color: "#eceaf4" },
  ],
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

const THEME_SCRIPT = `
try {
  var r = document.documentElement;
  var read = function (key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
      return null;
    }
  };

  var played = localStorage.getItem("timbre:history");
  if (played && played.length > 2) r.dataset.listener = "true";

  var t = read("timbre:theme") || {};
  var m = t.mode === "pastel" || t.mode === "custom" ? t.mode : "album";
  var light = m === "pastel" || (m === "custom" && t.customLight === true);
  r.dataset.theme = light ? "light" : "dark";
  r.dataset.mode = m;

  var thumb = function (key) {
    var v = localStorage.getItem(key);
    return v && v.indexOf("data:image/") === 0 ? "url(" + JSON.stringify(v) + ")" : null;
  };

  var a = thumb("timbre:thumb-avatar");
  if (a) {
    r.style.setProperty("--avatar-thumb", a);
    r.style.setProperty("--avatar-letter", "0");
  }

  var b = thumb("timbre:thumb-banner");
  if (b) r.style.setProperty("--banner-thumb", b);

  var mono = read("timbre:avatar-mono");
  if (mono) {
    if (mono.fill) r.style.setProperty("--avatar-fill", mono.fill);
    if (mono.initial) r.style.setProperty("--avatar-initial", JSON.stringify(mono.initial));
  }

  var saved = localStorage.getItem("timbre:profile-name");
  if (saved) r.style.setProperty("--profile-name", JSON.stringify(saved));

  var counts = read("timbre:profile-counts");
  if (counts && counts.playlists) {
    r.dataset.saved = counts.playlists === "0" ? "none" : "some";
    r.style.setProperty("--count-playlists", JSON.stringify(counts.playlists));
    r.style.setProperty("--label-playlists", JSON.stringify(counts.playlistsLabel || ""));
    r.style.setProperty("--count-songs", JSON.stringify(counts.songs || ""));
    r.style.setProperty("--label-songs", JSON.stringify(counts.songsLabel || ""));
    r.style.setProperty("--count-dot", '"·"');
  }

  var p = read("timbre:palette");
  if (p && p.vars) {
    for (var k in p.vars) if (k.indexOf("--") === 0) r.style.setProperty(k, p.vars[k]);
    if (p.theme) r.dataset.theme = p.theme;
    if (p.mode) r.dataset.mode = p.mode;
    r.dataset.neutral = String(p.neutral === true);
  }

  var w = read("timbre:profile-wash");
  if (w) {
    var v = r.dataset.theme === "light" ? w.light : w.dark;
    if (v) r.style.setProperty("--profile-wash", v);
  }
} catch (e) {}
`.trim();

const SW_CLEANUP_SCRIPT = `
try {
  if (navigator.serviceWorker) {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      if (!regs.length) return;
      Promise.all(regs.map(function (r) { return r.unregister(); }))
        .then(function () { return caches ? caches.keys() : []; })
        .then(function (names) {
          return Promise.all(names.filter(function (n) {
            return n.indexOf("timbre-") === 0;
          }).map(function (n) { return caches.delete(n); }));
        })
        .then(function () {
          if (sessionStorage.getItem("timbre:sw-cleared")) return;
          sessionStorage.setItem("timbre:sw-cleared", "1");
          location.reload();
        })
        .catch(function () {});
    }).catch(function () {});
  }
} catch (e) {}
`.trim();

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-theme="dark"
      data-mode="album"
      suppressHydrationWarning
    >
      <head>
        <link rel="preconnect" href="https://w.soundcloud.com" />
        <link rel="dns-prefetch" href="https://w.soundcloud.com" />
        <link rel="preconnect" href="https://widget.sndcdn.com" />
        <link rel="dns-prefetch" href="https://api-widget.soundcloud.com" />
        <link rel="dns-prefetch" href="https://player-widget.mixcloud.com" />
        <link rel="dns-prefetch" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />

        <script
          dangerouslySetInnerHTML={{
            __html:
              process.env.NODE_ENV === "production"
                ? THEME_SCRIPT
                : `${THEME_SCRIPT}\n${SW_CLEANUP_SCRIPT}`,
          }}
        />
      </head>
      <body className="h-full">
        <PlayerProvider>
          <AppShell>{children}</AppShell>
        </PlayerProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
