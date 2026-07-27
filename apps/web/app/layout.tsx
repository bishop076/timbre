import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { NowPlaying } from "./player/now-playing";
import { PlayerProvider } from "./player/player-context";
import { PlayerBar } from "./shell/player-bar";
import { BottomNav, Sidebar } from "./shell/sidebar";

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
 * The app shell.
 *
 * Desktop is the familiar three-zone music-app arrangement — navigation left,
 * one scrolling content region, a persistent player across the bottom — with
 * the content region **inset as its own rounded panel** rather than running to
 * the window edges. The gap is what separates "an app" from "a web page": the
 * ground shows through, and the ambient wash from the current artwork lives in
 * that gap.
 *
 * Phones get a different shape rather than a squeezed one: the rail becomes a
 * bottom nav, and the player collapses to a mini bar directly above it, so both
 * sit in thumb reach.
 *
 * Only the content region scrolls. Everything else is fixed, which is what
 * keeps playback controls reachable without hunting.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <PlayerProvider>
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1">
              <Sidebar />
              <main className="ambient scroller relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)]">
                {children}
              </main>
            </div>
            <PlayerBar />
            <BottomNav />
          </div>
          <NowPlaying />
        </PlayerProvider>
      </body>
    </html>
  );
}
