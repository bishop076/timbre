import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { PlayerProvider } from "./player/player-context";

import { ServiceWorker } from "./service-worker";
import { AppShell } from "./shell/app-shell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // The tab, before <TabTitle> takes it over on hydration. Bare on purpose: the tagline
  // belongs on the page, not in twenty characters of tab.
  title: "Timbre",
  description:
    "Search YouTube Music, SoundCloud and more from one place. Every track plays from the service it belongs to.",
  applicationName: "Timbre",
  openGraph: {
    type: "website",
    siteName: "Timbre",
    title: "Timbre — all your music, one search",
    description:
      "Search YouTube Music, SoundCloud and more from one place. Every track plays from the service it belongs to.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Timbre — all your music, one search",
    description:
      "Search YouTube Music, SoundCloud and more from one place. Every track plays from the service it belongs to.",
  },
  // iOS ignores the manifest and reads these instead; without them "Add to Home
  // Screen" gives a Safari bookmark rather than an installed app.
  appleWebApp: {
    capable: true,
    title: "Timbre",
    // The status bar sits over the page, so the app's own ground shows through
    // rather than a white band above the header.
    statusBarStyle: "black-translucent",
  },
  // Social crawlers need the public production domain. VERCEL_URL points to a
  // deployment-specific host that can redirect anonymous requests to Vercel login.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : "http://localhost:3000"),
  ),
};

/**
 * `viewport-fit=cover` lets the app reach into a phone's safe areas; without it
 * an installed Timbre is letterboxed at the notch and home indicator.
 *
 * Zooming stays enabled deliberately — disabling it is the usual reflex for an
 * app-like feel and it takes pinch-zoom from anyone who needs it to read.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0f0f14" },
    { media: "(prefers-color-scheme: light)", color: "#eceaf4" },
  ],
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

/**
 * Replays the signed-in look onto <html> before the first paint.
 *
 * **Must be a blocking inline script; a component cannot do this.** Every store
 * reads `localStorage` in `getSnapshot` and returns empty from
 * `getServerSnapshot`, so the server render and the hydration render both see a
 * stranger's view — no name, no picture, no counts. A React effect would fix it
 * a frame *after* paint, which is the flash itself.
 *
 * It only replays what the client recorded; nothing here recomputes a value, so
 * there is no second implementation to drift from the first.
 *
 * **No backticks anywhere inside this literal** — comments included. One ends
 * the template and breaks the root layout, so every page 500s.
 *
 * The try/catch is load-bearing: storage throws rather than returning null in
 * private browsing, and an exception here would block rendering entirely.
 */
const THEME_SCRIPT = `
try {
  var r = document.documentElement;


  /*
   * One bad record must cost only itself. The whole script is a single
   * try/catch, so without this an unparseable value aborted every step after it
   * -- a corrupt profile record used to take the palette replay down with it.
   */
  var read = function (key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
      return null;
    }
  };

  /*
   * Whether this browser has listened to anything -- enough to stop Home
   * emitting the guest arrangement and then shoving two shelves in above it.
   *
   * The length test avoids a parse: an empty history is stored as "[]", so
   * anything longer has an entry in it.
   */
  var played = localStorage.getItem("timbre:history");
  if (played && played.length > 2) r.dataset.listener = "true";

  var t = read("timbre:theme") || {};
  var m = t.mode === "pastel" || t.mode === "custom" ? t.mode : "album";
  var light = m === "pastel" || (m === "custom" && t.customLight === true);
  r.dataset.theme = light ? "light" : "dark";
  r.dataset.mode = m;

  /*
   * The profile, handed to CSS before the first paint: the cached avatar and the
   * monogram underneath it, then the display name.
   *
   * Recorded rather than recomputed -- deriving the monogram needs the hash and
   * the tone scale, and a second copy of those here would drift from the first.
   * Each property is consumed by one rule; see profile/avatar.tsx and the
   * .profile-name rule in globals.css.
   */
  var a = localStorage.getItem("timbre:thumb-avatar");
  if (a && a.indexOf("data:image/") === 0) {
    r.style.setProperty("--avatar-thumb", 'url("' + a + '")');
    r.style.setProperty("--avatar-letter", "0");
  }

  var mono = read("timbre:avatar-mono");
  if (mono) {
    if (mono.fill) r.style.setProperty("--avatar-fill", mono.fill);
    // JSON.stringify produces a valid CSS string token: it quotes the value and
    // escapes the two characters that could end it early. Control characters are
    // stripped before the name is ever stored — see setDisplayName.
    if (mono.initial) r.style.setProperty("--avatar-initial", JSON.stringify(mono.initial));
  }

  /*
   * Not "name". This script runs at global scope, where a var of that name IS
   * window.name -- so assigning null coerced it to the string "null", the guard
   * below saw a truthy value, and every reader without a saved display name got
   * --profile-name set to "null". The sidebar rendered the word null until
   * hydration replaced it. See layout.test.ts.
   */
  var saved = localStorage.getItem("timbre:profile-name");
  if (saved) r.style.setProperty("--profile-name", JSON.stringify(saved));

  /*
   * The header's counts, one text node each -- not one sentence. The digits are
   * bold and bright and the labels are not, so a single-string stand-in got the
   * words right and the weight wrong, and visibly changed when React took over.
   */
  var counts = read("timbre:profile-counts");
  if (counts && counts.playlists) {
    // Which shape the playlist section will take. Reserving the wrong one is
    // worse than reserving nothing, so it is read rather than assumed: "0" means
    // the empty-state box. See the .saved-none / .saved-some rules.
    r.dataset.saved = counts.playlists === "0" ? "none" : "some";
    r.style.setProperty("--count-playlists", JSON.stringify(counts.playlists));
    r.style.setProperty("--label-playlists", JSON.stringify(counts.playlistsLabel || ""));
    r.style.setProperty("--count-songs", JSON.stringify(counts.songs || ""));
    r.style.setProperty("--label-songs", JSON.stringify(counts.songsLabel || ""));
    // The character itself, not a CSS escape: this string passes through a
    // template literal, where a two-backslash "00B7" is read as a legacy octal
    // escape and becomes a NUL byte. The document is UTF-8.
    r.style.setProperty("--count-dot", '"·"');
  }

  var p = read("timbre:palette");
  if (p && p.vars) {
    for (var k in p.vars) if (k.indexOf("--") === 0) r.style.setProperty(k, p.vars[k]);
    if (p.theme) r.dataset.theme = p.theme;
    if (p.mode) r.dataset.mode = p.mode;
    r.dataset.neutral = String(p.neutral === true);
  }

  /*
   * Must stay after the palette block: that block has the last word on
   * data-theme, and reading the ground before it picks the light gradient for a
   * dark page whenever the stored palette disagrees with the mode.
   */
  var w = read("timbre:profile-wash");
  if (w) {
    var v = r.dataset.theme === "light" ? w.light : w.dark;
    if (v) r.style.setProperty("--profile-wash", v);
  }
} catch (e) {}
`.trim();

/**
 * Evicts a service worker left behind by a production build, in development.
 *
 * **Has to be inline, and that is the point.** The worker serves `/_next/static`
 * cache-first — correct in production where those URLs are fingerprinted, poison
 * against a dev server on the same origin, because Turbopack reuses chunk
 * *names*. The browser asks for a name it has, gets weeks-old bytes, and renders
 * current markup with stale JavaScript: components arrive `undefined`. A fix in a
 * component could not work, because the stale worker is what serves chunks.
 *
 * Development only; in production the worker is the feature.
 *
 * The reload is guarded by a session flag — unregistering does not retire the
 * worker controlling this page, and without the flag the refresh would loop.
 */
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

/**
 * The document. The arrangement lives in <AppShell>, which needs player state to
 * know whether the video is expanded — so that is a client component and this
 * stays a server one.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // Set by the script below before paint. Declaring the default here too
      // keeps server and client markup identical, which is what stops React
      // warning about a hydration mismatch on <html>.
      data-theme="dark"
      data-mode="album"
      suppressHydrationWarning
    >
      <head>
        {/*
         * The hosts a player reaches for the moment someone presses play.
         *
         * **This does not fix the wait, and it is worth saying which wait.** Measured
         * 2026-08-20: SoundCloud's `widget.load()` takes ~2.3s to resolve a track inside its
         * own iframe, and audio is audible 24ms after its callback — so the gap between
         * tracks is the widget's resolve, not anything on this side, and no hint can remove
         * it. What a hint *can* remove is the DNS lookup and TLS handshake in front of it,
         * which the same measurement put at ~1.9s for the widget's own `api.js` on a cold
         * connection.
         *
         * Hints only, so nothing is fetched for a reader who never plays that source.
         */}
        <link rel="preconnect" href="https://w.soundcloud.com" />
        <link rel="dns-prefetch" href="https://w.soundcloud.com" />
        <link rel="preconnect" href="https://widget.sndcdn.com" />
        <link rel="dns-prefetch" href="https://api-widget.soundcloud.com" />
        <link rel="dns-prefetch" href="https://player-widget.mixcloud.com" />
        <link rel="dns-prefetch" href="https://www.youtube.com" />
        <link rel="dns-prefetch" href="https://www.youtube-nocookie.com" />

        {/* One tag, not two: React warns about every script it meets while
            rendering, so a second doubles a message that is already noise. */}
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
