import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { PlayerProvider } from "./player/player-context";
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
  var t = JSON.parse(localStorage.getItem("timbre:theme") || "{}");
  var m = t.mode === "pastel" || t.mode === "custom" ? t.mode : "album";
  var light = m === "pastel" || (m === "custom" && t.customLight === true);
  document.documentElement.dataset.theme = light ? "light" : "dark";
  document.documentElement.dataset.mode = m;
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
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="h-full">
        <PlayerProvider>
          <AppShell>{children}</AppShell>
        </PlayerProvider>
      </body>
    </html>
  );
}
