"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

// Fetched when their tab is first opened: a static import would bundle both, and this
// panel is in the root shell, so that cost lands on every route. The default tab is
// `queue`, passed in, so the common case downloads neither.
const LyricsPanel = dynamic(() => import("./lyrics-panel").then((m) => m.LyricsPanel));
const RelatedPanel = dynamic(() => import("./related-panel").then((m) => m.RelatedPanel));

// The expanded player's right-hand column: three tabs over one pane. No Comments tab,
// unlike YouTube Music — comments belong to the upload rather than the recording, they need
// the keyed data API, and a fallback copy would show a different thread each time.

const TABS = [
  { id: "queue", label: "Up next" },
  { id: "lyrics", label: "Lyrics" },
  { id: "related", label: "Related" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function PanelTabs({ queue }: { queue: ReactNode }) {
  const [active, setActive] = useState<TabId>("queue");

  return (
    <>
      <div
        role="tablist"
        aria-label="Now playing"
        className="flex shrink-0 gap-1 border-b-[length:var(--edge)] border-[var(--ink)] px-2"
      >
        {TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={selected}
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

      {/* Only the selected pane is mounted: the other two fetch on mount, so keeping
          them alive fires two requests per track change. */}
      {active === "queue" && queue}
      {active === "lyrics" && <LyricsPanel />}
      {active === "related" && <RelatedPanel />}
    </>
  );
}
