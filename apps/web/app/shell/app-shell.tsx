"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { NowPlayingPanel } from "../player/now-playing";
import { usePlayerControls } from "../player/player-context";
import { RemoteBar } from "../player/remote-bar";
import { useArtworkAccent } from "../player/use-artwork-accent";
import { useSleepTimerDriver } from "../player/use-sleep-timer";
import { useRemotePlayer } from "../player/use-tab-sync";
import { useTransportKeys } from "../player/use-transport-keys";
import { TopBar } from "../top-bar";
import { PlayerBar } from "./player-bar";
import { BottomNav, Sidebar } from "./sidebar";

let movedOnce = false;

export function AppShell({ children }: { children: ReactNode }) {
  const { theater, current } = usePlayerControls();
  const remote = useRemotePlayer();
  const mirrored = current ? null : remote;
  const pathname = usePathname();

  const [openedAt] = useState(pathname);
  const navigated = movedOnce || pathname !== openedAt;

  useEffect(() => {
    if (pathname !== openedAt) movedOnce = true;
  }, [pathname, openedAt]);

  useArtworkAccent(current?.artworkUrl ?? mirrored?.report.song.artworkUrl);
  useTransportKeys();
  useSleepTimerDriver();

  const title = current ? `Timbre · ${current.title}` : "Timbre";
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);

  const panel = useRef<HTMLElement>(null);
  const [overflowing, setOverflowing] = useState(true);

  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={
        {
          "--chrome-b": current || mirrored
            ? "calc(var(--bar-h) + var(--nav-h) + var(--safe-b))"
            : "calc(var(--nav-h) + var(--safe-b))",
        } as React.CSSProperties
      }
    >
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main
          ref={panel}
          className={`${pathname.startsWith("/profile") ? "" : "ambient"} ${overflowing ? "scroll-fade" : ""} scroller-quiet relative min-h-0 flex-1 overflow-y-auto bg-[var(--surface-1)] lg:my-2 lg:mr-2 lg:rounded-[var(--r-lg)] lg:border-[length:var(--edge)] lg:border-[var(--ink)] lg:shadow-[var(--drop)] ${
            theater ? "hidden" : ""
          }`}
        >
          <div className="relative z-10">
            <TopBar />
            <div key={pathname} className={navigated ? "page-in" : undefined}>
              {children}
            </div>
          </div>
        </main>
        <NowPlayingPanel />
      </div>
      <div className={theater ? "hidden lg:contents" : "contents"}>
        <PlayerBar />
        {mirrored && <RemoteBar remote={mirrored} />}
        <BottomNav />
      </div>
    </div>
  );
}
