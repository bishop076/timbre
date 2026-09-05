"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ReactNode } from "react";

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

/** A pane with one line of explanation instead of content. Lives here because Lyrics and
 * Related both have four of these and had byte-identical copies. */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <p className="text-center text-sm leading-relaxed text-[var(--fg-faint)]">{children}</p>
    </div>
  );
}

export function PanelTabs({ queue }: { queue: ReactNode }) {
  const [active, setActive] = useState<TabId>("queue");
  const list = useRef<HTMLDivElement>(null);

  /**
   * Arrow keys move between the tabs, which is the half of `role="tab"` that was missing.
   *
   * The roles were here already and the behaviour behind them was not, which is worse than
   * having neither: a screen reader announced "tab, 1 of 3", the reader pressed Right
   * expecting the next one, and nothing happened. Three plain buttons would at least have
   * promised nothing. Home and End go to the ends, as the tabs pattern specifies.
   *
   * Selection follows focus — correct here because switching costs nothing to undo, and
   * every pane is already mounted lazily on demand.
   */
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
    // Or Left/Right would also scroll the pane underneath, and Home would jump it.
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
              /* One tab stop for the whole set, not three: Tab should carry on past the
                 tablist, and the arrows above are what walks it. */
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

      {/*
        The pane the tab above points at. It has to exist as an element for `aria-controls`
        to name, and every pane was previously a bare fragment sitting directly in this
        column — so the wrapper carries exactly the flex classes those fragments were
        relying on from the parent, and their `shrink-0` headers and `min-h-0 flex-1`
        scrollers lay out against it unchanged.

        Only the selected pane is mounted: the other two fetch on mount, so keeping them
        alive fires two requests per track change.
      */}
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
