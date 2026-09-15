import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { PlayerProvider } from "./player/player-context";
import { ServiceWorker } from "./service-worker";
import { AppShell } from "./shell/app-shell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// The banner violet, and --accent in globals.css.
const ACCENT = "#5b3fd6";

const DESCRIPTION = "Search YouTube Music, SoundCloud and more from one place.";

// The card a pasted link unfurls into needs to say which site it is. Cut to "All your music, one
// search" the title read as a slogan from nowhere — the name only appeared in the artwork, which
// a reader skims past and a screen reader never sees. Convention for a link preview is name first,
// then what it does, which is what this is.
const SHARED = {
  title: "Timbre — all your music, one search",
  description: DESCRIPTION,
  siteName: "Timbre",
};

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
  // Both entries are the brand violet, not one per scheme. This is what a link card colours its
  // strip with, and every unfurler I can see ignores the media attribute and takes the first tag —
  // so a light-scheme near-white here means a near-white strip on half of them.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: ACCENT },
    { media: "(prefers-color-scheme: light)", color: ACCENT },
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

  // Not one backslash anywhere in this script, and a test below that keeps it that way. The
  // script is a template literal: an escape in the source is resolved before the browser sees
  // it, so a backslash-s reaches the page as a plain "s", while the tests read the literal's
  // raw text and still see the escape. A regex written with escapes would pass every test
  // here and be a different regex in production. None are needed: inside a character class a
  // slash needs no escape, and [(] matches what an escaped bracket would.
  var PICTURE = /^data:image[/](?:png|jpeg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/;
  var thumb = function (key) {
    var v = localStorage.getItem(key);
    return v && v.length <= 700000 && PICTURE.test(v) ? "url(" + JSON.stringify(v) + ")" : null;
  };

  var PALETTE = " --accent-text --bg --surface-1 --surface-2 --surface-3 --fg --fg-dim --fg-faint --ink --line --accent --accent-fg --accent-wash --drop --drop-sm --drop-lg ";

  // A denylist of dangerous substrings was wrong in both directions. It rejected the real
  // --profile-wash, which reads var(--surface-1) and is built that way in profile-view.tsx,
  // so the header lost its pre-paint wash; and it could only ever refuse the sinks someone
  // had already thought of. This is the inverse. Nothing reaches setProperty unless every
  // character is in a set that cannot open a string, a comment or a second declaration, and
  // every "(" in it is preceded by a function on FUNCTIONS. url(), image-set(), element(),
  // attr() and expression() are not on it, so none of them needs naming.
  //
  // var() is allowed only as var(--token) with --token on PALETTE, and no fallback — a
  // fallback is a second value, and var(--a, url(x)) is the sink wearing a hat. That is what
  // makes it safe rather than a hole: every property on PALETTE is either a globals.css
  // default or something paint() below put there, under this same grammar. The set is
  // closed, so no chain of var() can arrive anywhere this function would not have allowed
  // directly.
  var FUNCTIONS = " rgb rgba hsl hsla hwb lab lch oklab oklch color color-mix calc min max clamp linear-gradient radial-gradient conic-gradient repeating-linear-gradient repeating-radial-gradient repeating-conic-gradient ";
  var SAFE = /^[a-z0-9 (),.%#/*+_-]+$/;

  var css = function (value, limit) {
    if (typeof value !== "string" || !value || value.length > limit) return null;
    var low = value.toLowerCase();
    if (!SAFE.test(low) || low.indexOf("/*") >= 0) return null;
    var call = /([a-z0-9-]*)[(]/g;
    var found;
    while ((found = call.exec(low))) {
      if (found[1] === "var") {
        var named = /^ *(--[a-z0-9-]+) *[)]/.exec(low.slice(call.lastIndex));
        if (!named || PALETTE.indexOf(" " + named[1] + " ") < 0) return null;
      } else if (FUNCTIONS.indexOf(" " + found[1] + " ") < 0) return null;
    }
    return value;
  };

  var paint = function (name, value) {
    if (PALETTE.indexOf(" " + name + " ") < 0) return;
    if (css(value, 120)) r.style.setProperty(name, value);
  };
  var tint = function (name, value) {
    if (css(value, 240)) r.style.setProperty(name, value);
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
    if (mono.fill) tint("--avatar-fill", mono.fill);
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
    for (var k in p.vars) paint(k, p.vars[k]);
    // Two values each, matched exactly. These select rules in globals.css, and a planted
    // third value is not an attack so much as a way to leave the page in a state no
    // stylesheet describes — dark variables under a light ground, with no way back.
    if (p.theme === "light" || p.theme === "dark") r.dataset.theme = p.theme;
    if (p.mode === "album" || p.mode === "pastel" || p.mode === "custom") r.dataset.mode = p.mode;
    r.dataset.neutral = String(p.neutral === true);
  }

  var w = read("timbre:profile-wash");
  if (w) {
    var v = r.dataset.theme === "light" ? w.light : w.dark;
    if (v) tint("--profile-wash", v);
  }

  // The reader's own picture behind the app, and the interface scale — replayed last, and the
  // reason theme/background.ts keeps a small copy of the picture in localStorage at all. Both
  // of these are otherwise applied only once React is up, which the reader sees as a flat
  // theme and a jump in text size on every single load.
  //
  // This is the ES5 twin of replayProperties() in app/customise/replay.ts, which is itself
  // built out of the live path's own parseTheme() and backgroundVars(). The parity test in
  // layout.test.ts replays one corpus through both and compares what lands on the root, so a
  // clamp that changes there and not here is a failing test rather than a pre-paint frame
  // that disagrees with every frame after it.
  //
  // The picture is the only free-form value in the whole customisation surface, and the only
  // one spliced into a url(). Hence PICTURE: base64 of a raster type, an alphabet with no
  // quote in it, checked before JSON.stringify quotes it anyway.
  //
  // number() and clamp() are the pair theme/custom-theme.ts validates these with, in the same
  // order: a value that is not a number becomes the default first, and only then is it held
  // between its ends. Rounding a non-number instead produces 0, which is how a planted
  // "blur": null became no blur here and 8px everywhere else — caught by the parity test.
  var number = function (value, fallback) {
    return typeof value === "number" && isFinite(value) ? value : fallback;
  };
  var clamp = function (value, low, high) {
    return Math.min(high, Math.max(low, value));
  };

  var bg = localStorage.getItem("timbre:theme-bg");
  if (bg && bg.length <= 700000 && PICTURE.test(bg)) {
    var prefs = (t && typeof t.background === "object" && t.background) || {};
    var fit = prefs.fit === "contain" || prefs.fit === "tile" ? prefs.fit : "cover";
    r.dataset.bgImage = "true";
    r.style.setProperty("--app-bg-image", "url(" + JSON.stringify(bg) + ")");
    r.style.setProperty("--app-bg-size", fit === "tile" ? "auto" : fit);
    r.style.setProperty("--app-bg-repeat", fit === "tile" ? "repeat" : "no-repeat");
    r.style.setProperty("--app-bg-dim", String(clamp(number(prefs.dim, 0.6), 0.3, 0.92)));
    r.style.setProperty("--app-bg-blur", clamp(Math.round(number(prefs.blur, 8)), 0, 40) + "px");
    // The scrim is the ground colour, not black, and the ground is whatever the palette above
    // settled on — a light wash under dark text for one frame is the bug this avoids.
    // These two are GROUND in theme/custom-theme.ts, written out as literals because the boot
    // script is a template string and cannot import. A parity test compares this script against
    // the live path, which is how the stale pair was caught when the palette went pink.
    r.style.setProperty("--app-bg-scrim", r.dataset.theme === "light" ? "#f6f4fc" : "#0b0814");
  }

  var scale = clamp(Math.round(number(t.textScale, 1) * 100) / 100, 0.85, 1.5);
  r.style.setProperty("--ui-scale", String(scale));
  if (scale !== 1) r.style.setProperty("font-size", Math.round(scale * 100) + "%");
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
