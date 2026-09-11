"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";

import { getPlaybackPrefs } from "./playback-prefs";

const LyricsPanel = dynamic(() => import("./lyrics-panel").then((m) => m.LyricsPanel));
const RelatedPanel = dynamic(() => import("./related-panel").then((m) => m.RelatedPanel));

const TABS = [
  { id: "queue", label: "Up next" },
  { id: "lyrics", label: "Lyrics" },
  { id: "related", label: "Related" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <p className="text-center text-sm leading-relaxed text-[var(--fg-faint)]">{children}</p>
    </div>
  );
}

export function PanelTabs({ queue }: { queue: ReactNode }) {
  const [active, setActive] = useState<TabId>(() =>
    getPlaybackPrefs().lyricsByDefault ? "lyrics" : "queue",
  );
  const list = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const from = TABS.findIndex((tab) => tab.id === active);
    const to =
      event.key === "ArrowRight"
        ? (from + 1) % TABS.length
        : event.key === "ArrowLeft"
          ? (from - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;

    if (to === null) return;
    event.preventDefault();
    setActive(TABS[to]!.id);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  }

  return (
    <>
      <div
        ref={list}
        role="tablist"
        aria-label="Now playing"
        onKeyDown={onKeyDown}
        className="flex shrink-0 gap-1 border-b-[length:var(--edge)] border-[var(--ink)] px-2"
      >
        {TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              id={`panel-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`panel-pane-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(tab.id)}
              className={`relative px-3 py-3 text-[11px] font-bold uppercase tracking-wider transition-colors ${
                selected ? "text-[var(--fg)]" : "text-[var(--fg-faint)] hover:text-[var(--fg-dim)]"
              }`}
            >
              {tab.label}
              {selected && (
                <span
                  aria-hidden
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-pane-${active}`}
        aria-labelledby={`panel-tab-${active}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {active === "queue" && queue}
        {active === "lyrics" && <LyricsPanel />}
        {active === "related" && <RelatedPanel />}
      </div>
    </>
  );
}
