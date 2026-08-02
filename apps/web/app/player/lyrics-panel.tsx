"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Song } from "../types";
import { usePlayer } from "./player-context";

/**
 * Lyrics that follow the music.
 *
 * The interesting part is not fetching them, it is the highlight: a line is
 * "current" from its own timestamp until the next one, and the panel keeps that
 * line in view without fighting a reader who has scrolled away to look at the
 * chorus. Both of those are the difference between a lyrics panel and a
 * paragraph of text.
 *
 * Timings come from LRCLIB when the track has them and are absent often enough
 * that plain text is a first-class fallback rather than an error state.
 */

interface LyricLine {
  at: number;
  text: string;
}

interface Lyrics {
  instrumental: boolean;
  synced: LyricLine[] | null;
  plain: string | null;
  matchedTitle: string;
  matchedArtist: string;
}

function useLyrics(song: Song | null): { lyrics: Lyrics | null; loading: boolean } {
  /*
   * The answer is stored *with the song it was fetched for*, and matched at
   * render. That makes "loading" a derived fact — a key with no answer yet —
   * rather than a second state to flip on the way in, which would be a render
   * pass spent announcing that a render pass is coming.
   */
  const [state, setState] = useState<{ key: string; lyrics: Lyrics | null } | null>(null);

  // Identity of the *song*, not the object: the queue hands back new objects
  // for the same track and a reference check would refetch on every render.
  const key = song ? `${song.title}::${song.artists[0] ?? ""}::${song.durationMs ?? ""}` : "";

  useEffect(() => {
    if (!song || !key) return;

    const aborter = new AbortController();

    const params = new URLSearchParams({
      title: song.title,
      artist: song.artists[0] ?? "",
    });
    if (song.album) params.set("album", song.album);
    if (song.durationMs) params.set("duration", String(Math.round(song.durationMs / 1000)));

    fetch(`/api/lyrics?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ lyrics: Lyrics | null }>) : null))
      .then((data) => setState({ key, lyrics: data?.lyrics ?? null }))
      .catch((cause: unknown) => {
        // Settle even on failure. Leaving it unset kept `loading` true for the
        // rest of the song, so an offline moment showed "Looking for lyrics…"
        // forever instead of admitting there were none.
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setState({ key, lyrics: null });
      });

    return () => aborter.abort();
  }, [key, song]);

  const settled = state?.key === key;
  return { lyrics: settled ? state.lyrics : null, loading: Boolean(song) && !settled };
}

export function LyricsPanel() {
  const { current, position, seek } = usePlayer();
  const { lyrics, loading } = useLyrics(current);

  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);

  /**
   * When the reader scrolls, the panel stops chasing the song for a while.
   *
   * Without this, looking ahead to the next verse is impossible: the next
   * timestamp yanks the view back within a second or two. Auto-scroll resumes
   * on its own so it never has to be switched back on.
   */
  const [following, setFollowing] = useState(true);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines = lyrics?.synced ?? null;

  /** The last line whose timestamp has passed. */
  const activeIndex = useMemo(() => {
    if (!lines || lines.length === 0) return -1;
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    // Binary search: a long song is hundreds of lines and this runs on every
    // position tick.
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lines[mid]!.at <= position) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }, [lines, position]);

  useEffect(() => {
    if (!following || activeIndex < 0) return;

    const box = container.current;
    const line = activeLine.current;
    if (!box || !line) return;

    /*
     * Scrolled by arithmetic rather than `scrollIntoView`.
     *
     * That helper walks up and scrolls *every* scrollable ancestor to bring the
     * element into view, which here means the shell itself can move — the panel
     * scrolls and the whole app lurches with it. Setting this container's own
     * `scrollTop` moves exactly one box.
     *
     * `offsetTop` is measured against the container because it is positioned,
     * which is what makes it the offset parent.
     */
    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex, following]);

  function onUserScroll() {
    setFollowing(false);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setFollowing(true), 6_000);
  }

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  if (!current) {
    return <Empty>Play something to see its lyrics.</Empty>;
  }

  if (loading && !lyrics) {
    return <Empty>Looking for lyrics…</Empty>;
  }

  if (!lyrics || (lyrics.instrumental && !lyrics.plain && !lines)) {
    return (
      <Empty>
        {lyrics?.instrumental ? "This one is instrumental." : "No lyrics found for this track."}
      </Empty>
    );
  }

  // Timed lines — the good case.
  if (lines && lines.length > 0) {
    return (
      <div
        ref={container}
        onWheel={onUserScroll}
        onTouchMove={onUserScroll}
        /*
         * Padded top and bottom by roughly half the pane, so the first and last
         * lines can still reach the centre. Without it a song opens with the
         * highlight pinned to the top edge and ends with it stuck at the bottom
         * — the giveaway that a lyrics view is really a list.
         *
         * `vh`, not `%`. Percentage padding resolves against the containing
         * block's **width**, not its height, so `py-[40%]` on a 340px-wide
         * panel gives 136px against a pane six hundred tall — a third of what
         * centring needs, and it would shrink further the narrower the panel
         * got, which is exactly backwards.
         */
        className="scroller-quiet relative min-h-0 flex-1 overflow-y-auto px-5 py-[38vh]"
      >
        {lines.map((line, index) => {
          const isActive = index === activeIndex;
          const isPast = index < activeIndex;
          return (
            <button
              key={`${line.at}-${index}`}
              ref={isActive ? activeLine : undefined}
              type="button"
              // Clicking a line seeks to it, which is the fastest way to replay
              // a phrase and the reason these are buttons rather than <p>.
              onClick={() => seek(line.at)}
              /*
               * Three states, distinguished by weight and opacity rather than
               * hue alone. Colour-only emphasis disappears against a tinted
               * shell — the accent shifts with the artwork, so the current line
               * has to be legible even when it lands near the panel's own tint.
               */
              className={`block w-full origin-left py-2.5 text-left text-xl font-extrabold leading-tight transition-all duration-500 ease-[var(--ease)] @lg:text-[1.6rem] ${
                isActive
                  ? "scale-100 text-[var(--fg)] opacity-100"
                  : isPast
                    ? "scale-[0.97] text-[var(--fg-dim)] opacity-35 hover:opacity-60"
                    : "scale-[0.97] text-[var(--fg-dim)] opacity-55 hover:opacity-85"
              }`}
            >
              {/* A timed blank is a gap in the song, not an empty row — it
                  still has to occupy its slot or the highlight jumps early. */}
              {line.text || <span className="opacity-40">♪</span>}
            </button>
          );
        })}

        {/* Only while the reader has scrolled away. It re-arms itself after a
            few seconds, so this is a shortcut rather than the only way back. */}
        {!following && (
          <button
            type="button"
            onClick={() => setFollowing(true)}
            className="slab-sm press sticky bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-[var(--r-full)] bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-bold"
          >
            Follow the song
          </button>
        )}
      </div>
    );
  }

  // Untimed lyrics. Still worth showing, just not scrolled.
  return (
    <div className="scroller-quiet min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <p className="whitespace-pre-wrap text-base font-semibold leading-relaxed text-[var(--fg-dim)]">
        {lyrics.plain}
      </p>
      <p className="mt-6 border-t-[length:var(--edge)] border-[var(--ink)] pt-3 text-[11px] leading-relaxed text-[var(--fg-faint)]">
        No timings for this one, so it can&rsquo;t follow along. Lyrics from LRCLIB.
      </p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <p className="text-center text-sm leading-relaxed text-[var(--fg-faint)]">{children}</p>
    </div>
  );
}
