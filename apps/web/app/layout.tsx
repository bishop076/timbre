import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { PlayerBar } from "./shell/player-bar";
import { Sidebar } from "./shell/sidebar";

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
 * The app shell: sidebar, scrolling content, persistent player bar.
 *
 * The three-zone layout is the standard music-app arrangement, and it is what
 * makes the difference between a search page and something that feels like a
 * player. Only the middle zone scrolls, so the player bar stays put.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        <div className="flex h-full flex-col">
          <div className="flex min-h-0 flex-1">
            <Sidebar />
            <main className="timbre-glow relative min-h-0 flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
          <PlayerBar />
        </div>
      </body>
    </html>
  );
}
