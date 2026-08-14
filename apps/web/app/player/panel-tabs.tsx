"use client";

import dynamic from "next/dynamic";
import { useState, type ReactNode } from "react";

/**
 * Both panes are fetched when their tab is first opened, not before.
 *
 * Only the selected pane is ever mounted, but a static import puts both in the
 * bundle regardless — and this panel lives in the root shell, so that cost was
 * on *every* route, including /about. Between them they are the largest pair of
 * leaves in the player: lyrics carries an LRC parser and a synced scroller,
 * related carries its own fetch and row list.
 *
 * The default tab is Up Next, which is `queue` and passed in from above, so the
 * common case now downloads neither.
 */
const LyricsPanel = dynamic(() => import("./lyrics-panel").then((m) => m.LyricsPanel));
const RelatedPanel = dynamic(() => import("./related-panel").then((m) => m.RelatedPanel));

/**
 * The expanded player's right-hand column, as YouTube Music arranges it.
 *
 * Three tabs over one pane. Up Next is what *will* play, Related is what
 * *could*, and Lyrics is the reason anyone leaves this view open — the queue is
 * a list you consult, the lyrics are something you watch.
 *
 * **No Comments tab.** YouTube Music has one; Timbre cannot. Comments belong to
 * the upload rather than the recording, they are only reachable through the
 * data API that would need a key and a quota, and a song Timbre plays from a
 * fallback copy would show a different thread each time. Its absence is a
 * limitation worth stating rather than an oversight.
 *
 * Up Next is passed in rather than built here: it is the queue the surrounding
 * panel already renders, and lifting it would mean two components disagreeing
 * about what is playing next.
 */

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
      {/*
        A row of underlined labels, not chips. It is the shape YouTube Music,
        Spotify's desktop app and every browser use for a tab strip, so it reads
        as "these swap the pane below" without anything having to say so.
      */}
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
              {/*
                The underline sits on the container's own border line rather
                than under the label, so the selected tab reads as connected to
                the pane it controls.
              */}
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
        Only the selected pane is mounted. Lyrics and Related each fetch on
        mount, so keeping all three alive would mean every track change firing
        two requests nobody asked for.
      */}
      {active === "queue" && queue}
      {active === "lyrics" && <LyricsPanel />}
      {active === "related" && <RelatedPanel />}
    </>
  );
}
