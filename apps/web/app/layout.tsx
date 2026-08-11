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
  title: "Timbre — one search across free music",
  description:
    "Search YouTube Music, SoundCloud and more from one place. Every track plays from the service it belongs to.",
  applicationName: "Timbre",
  /*
   * iOS ignores the web manifest almost entirely — `display: standalone`,
   * `name` and the icons are all read from these meta tags instead. Without
   * them "Add to Home Screen" produces a bookmark that opens in Safari with
   * full browser chrome, which is not an installed app by any definition.
   */
  appleWebApp: {
    capable: true,
    title: "Timbre",
    // The status bar sits *over* the page, so the app's own dark ground shows
    // through it rather than a white band above the header.
    statusBarStyle: "black-translucent",
  },
  /*
   * The origin relative metadata resolves against.
   *
   * This briefly said `https://timbre.local`, which is not a domain anybody
   * owns — every absolute URL Next generated would have pointed at a host that
   * does not resolve. Taken from the deployment instead, with localhost for a
   * dev server, so the value is either true or obviously local.
   */
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000"),
  ),
};

/**
 * `viewport-fit=cover` is what lets the app reach into a phone's safe areas —
 * without it an installed Timbre is letterboxed by white bands at the notch and
 * the home indicator. `themeColor` paints the chrome around it to match.
 *
 * Zooming stays enabled. Disabling it is the usual reflex for an app-like feel
 * and it takes pinch-zoom away from anyone who needs it to read.
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
 * The document.
 *
 * The arrangement itself lives in <AppShell>, which needs player state to know
 * whether the video is expanded — so it is a client component and this stays a
 * server one.
 */
/**
 * Stamps the stored theme onto <html> before the first paint.
 *
 * This has to be a blocking inline script and cannot be a component. The theme
 * lives in `localStorage`, which the server cannot read, so a React effect
 * would set it a frame *after* the browser has already painted the system
 * scheme — the white flash that every theme-switching app has to solve exactly
 * this way.
 *
 * It deliberately does very little: the ground only, read from one key. The
 * full palette is CSS (`:root[data-theme=…]` in globals.css) and the hue is
 * refined from the artwork once React is running, so nothing here duplicates
 * the ramp — duplicating it would guarantee the two drift apart.
 *
 * Wrapped in try/catch because storage throws rather than returning null in
 * private browsing, and an exception here would block rendering entirely.
 */
const THEME_SCRIPT = `
try {
  var r = document.documentElement;


  /*
   * One bad record must cost only itself.
   *
   * Everything below is read out of storage a reader can edit, and this whole
   * script is one try/catch — so a single unparseable value used to abort every
   * step after it. That is how a corrupt profile record would have taken the
   * *palette* replay down with it and brought back the black-to-colour flash
   * the palette record exists to prevent. Four independent reads, four
   * independent failures.
   */
  var read = function (key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch (e) {
      return null;
    }
  };

  /*
   * Whether this browser has listened to anything.
   *
   * The one fact about a history the first paint can know, and it is enough to
   * stop Home rendering the wrong arrangement. Everything personalised on that
   * page reads localStorage, which the server cannot — so the server always
   * emitted the layout a *first-time visitor* should see, and hydration then
   * inserted two shelves above the charts and pushed the page down. A returning
   * listener met the guest version of Home on every single load.
   *
   * The length test avoids a parse: an empty history is stored as "[]", so
   * anything longer has at least one entry in it. Nothing here needs to know
   * what was played, only that something was.
   */
  var played = localStorage.getItem("timbre:history");
  if (played && played.length > 2) r.dataset.listener = "true";

  var t = read("timbre:theme") || {};
  var m = t.mode === "pastel" || t.mode === "custom" ? t.mode : "album";
  var light = m === "pastel" || (m === "custom" && t.customLight === true);
  r.dataset.theme = light ? "light" : "dark";
  r.dataset.mode = m;

  /*
   * The exact ramp this app painted last time, replayed before the first pixel.
   *
   * Without it the first paint uses the generic fallback palette in
   * globals.css and the reader's own ramp arrives a moment later — visible as a
   * flash from the default dark to their colour on every single load. The
   * values are whatever buildPalette produced, recorded by
   * player/use-artwork-accent.ts; nothing here recomputes them, so there is no
   * second implementation of the ramp to drift out of step.
   *
   * The attributes above are set first and then corrected from the record, so a
   * theme changed in another tab still wins if the record is stale.
   */
  /*
   * The profile, handed to CSS before the first paint.
   *
   * All of it is in localStorage — see profile/local-images.ts and
   * profile/local-profile.ts — so it is readable *here*, before anything is
   * drawn, and nowhere else this early: the server has none of it, and React
   * only has it after hydration. That is why the rail used to arrive without a
   * name or a picture and fill them in a frame later, dropping 32px and
   * snapping back as it did.
   *
   * Four properties, each consumed by exactly one rule:
   *
   * - --avatar-thumb / --avatar-letter — the cached picture as a background,
   *   and the initial hidden underneath it. profile/avatar.tsx.
   * - --avatar-fill / --avatar-initial — the monogram for somebody with no
   *   picture: the gradient and the letter, recorded rather than recomputed,
   *   because deriving them needs the hash and the tone scale and a second copy
   *   of those in this script would drift from the first.
   * - --profile-name — the display name, read by the .profile-name rule in
   *   globals.css. No backticks anywhere in here: this comment lives inside a
   *   template literal, and one would end it.
   *
   * Every one of them stops being consulted the moment React can read storage
   * itself, so nothing here can outlive the value it describes.
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

  var name = localStorage.getItem("timbre:profile-name");
  if (name) r.style.setProperty("--profile-name", JSON.stringify(name));

  /*
   * The header's counts, one text node each.
   *
   * Recorded per node rather than as a sentence because each one is styled
   * differently — the digits are bold and bright, the labels are not — and a
   * stand-in that gets the words right and the weight wrong still visibly
   * changes when React takes over. The dot only appears when there are figures
   * for it to sit between.
   */
  var counts = read("timbre:profile-counts");
  if (counts && counts.playlists) {
    /*
     * Which of the two shapes the playlist section will take.
     *
     * Reserving the wrong one would be worse than reserving nothing, so this is
     * read from the record rather than assumed: "0" means the empty-state box,
     * anything else means a grid. See the .saved-none / .saved-some rules.
     */
    r.dataset.saved = counts.playlists === "0" ? "none" : "some";
    r.style.setProperty("--count-playlists", JSON.stringify(counts.playlists));
    r.style.setProperty("--label-playlists", JSON.stringify(counts.playlistsLabel || ""));
    r.style.setProperty("--count-songs", JSON.stringify(counts.songs || ""));
    r.style.setProperty("--label-songs", JSON.stringify(counts.songsLabel || ""));
    // The character itself, not a CSS escape. This string passes through a
    // template literal on its way here, so "\\00B7" would need four backslashes
    // to survive as one — and with two it is read as a legacy octal escape and
    // becomes a NUL byte. The document is UTF-8 and the JSX below uses the same
    // character, so there is nothing to escape around.
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
   * The profile header's wash, replayed for the ground that was just settled.
   *
   * Deliberately after the palette block, because that block is what has the
   * last word on data-theme — reading the ground before it would pick the light
   * gradient for a dark page whenever the stored palette disagreed with the
   * mode. Both versions are recorded by profile/profile-view.tsx; this only
   * chooses.
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
 * **This has to be inline in the HTML, and that is the entire point of it.**
 * The worker serves everything under `/_next/static` cache-first and never
 * revalidates — correct in production, where those URLs are fingerprinted and
 * immutable, and poison the moment a dev server answers on the same origin.
 * Turbopack reuses chunk *names* across rebuilds, so the browser asks for a
 * name it already has, gets bytes from weeks-old code, and renders a page whose
 * markup is current and whose JavaScript is not. The symptom is components
 * arriving `undefined` and edits appearing only after a hard reload.
 *
 * A fix written in a component could not fix it: that code lives in a chunk,
 * and the stale worker is what serves chunks. Navigations are network-first, so
 * the document is always fresh — this is the one place guaranteed to run.
 *
 * Development only. In production the worker is the feature, not the fault.
 *
 * The reload is guarded by a session flag: unregistering does not retire the
 * worker already controlling this page, so without one refresh the page keeps
 * the stale scripts it started with — and without the flag, that refresh would
 * find the same condition and loop.
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      // The attribute is set by the script below before paint. Declaring the
      // default here too keeps the server and client markup identical, which
      // is what stops React warning about a hydration mismatch on <html>.
      data-theme="dark"
      data-mode="album"
      suppressHydrationWarning
    >
      <head>
        {/* One tag, not two. React warns about every `<script>` it meets while
            rendering a component, so a second one doubles a message that is
            already noise — and these two have nothing to say to each other that
            a blank line cannot express. */}
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
