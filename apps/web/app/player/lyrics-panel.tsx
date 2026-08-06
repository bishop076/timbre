"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChevronIcon, CheckIcon } from "../icons";
import type { Song } from "../types";
import {
  clearLyricsPref,
  setLyricsId,
  setLyricsOffset,
  songKey,
  useLyricsPref,
} from "./lyrics-prefs";
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
  id?: number;
}

interface Alternative {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  synced: boolean;
}

function useLyrics(
  song: Song | null,
  chosenId: number | undefined,
): { lyrics: Lyrics | null; loading: boolean } {
  /*
   * The answer is stored *with the song it was fetched for*, and matched at
   * render. That makes "loading" a derived fact — a key with no answer yet —
   * rather than a second state to flip on the way in, which would be a render
   * pass spent announcing that a render pass is coming.
   */
  const [state, setState] = useState<{ key: string; lyrics: Lyrics | null } | null>(null);

  // Identity of the *song*, not the object: the queue hands back new objects
  // for the same track and a reference check would refetch on every render.
  const key = song
    ? `${song.title}::${song.artists[0] ?? ""}::${song.durationMs ?? ""}::${chosenId ?? ""}`
    : "";

  useEffect(() => {
    if (!song || !key) return;

    const aborter = new AbortController();

    const params = new URLSearchParams({
      title: song.title,
      artist: song.artists[0] ?? "",
    });
    if (song.album) params.set("album", song.album);
    if (song.durationMs) params.set("duration", String(Math.round(song.durationMs / 1000)));
    // An explicit pick overrules the automatic match entirely.
    if (chosenId) params.set("id", String(chosenId));

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
  }, [key, song, chosenId]);

  const settled = state?.key === key;
  return { lyrics: settled ? state.lyrics : null, loading: Boolean(song) && !settled };
}

export function LyricsPanel() {
  const { current, position, seek } = usePlayer();

  // Corrections are keyed by the recording, not by the queue's object, so a
  // fix survives the same song arriving from a different source later.
  const prefKey = current ? songKey(current.title, current.artists[0] ?? "") : "";
  const pref = useLyricsPref(prefKey);

  const { lyrics, loading } = useLyrics(current, pref.id);
  const [fixing, setFixing] = useState(false);

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

  /*
   * The nudge is applied to the *playhead*, not to the lines.
   *
   * Shifting every timestamp would mean rebuilding the array on each change and
   * re-running the binary search over new objects; moving the single number the
   * search compares against is the same result for no allocation. A positive
   * offset means the words arrive late, so time is pushed forward to meet them.
   */
  const at = position + (pref.offset ?? 0);

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
      if (lines[mid]!.at <= at) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return found;
  }, [lines, at]);

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
      <>
      <LyricsToolbar
        song={current}
        prefKey={prefKey}
        lyrics={lyrics}
        offset={pref.offset ?? 0}
        open={fixing}
        onToggle={() => setFixing((was) => !was)}
        synced
      />
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
        className="scroller-quiet relative min-h-0 flex-1 overflow-y-auto px-4 py-[38vh] sm:px-5"
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
              className={`block w-full origin-left py-2 text-left text-lg font-extrabold leading-tight sm:py-2.5 sm:text-xl transition-all duration-500 ease-[var(--ease)] @lg:text-[1.6rem] ${
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
      </>
    );
  }

  // Untimed lyrics. Still worth showing, just not scrolled.
  return (
    <>
    <LyricsToolbar
      song={current}
      prefKey={prefKey}
      lyrics={lyrics}
      offset={0}
      open={fixing}
      onToggle={() => setFixing((was) => !was)}
      synced={false}
    />
    <div className="scroller-quiet min-h-0 flex-1 overflow-y-auto px-5 py-6">
      <p className="whitespace-pre-wrap text-base font-semibold leading-relaxed text-[var(--fg-dim)]">
        {lyrics.plain}
      </p>
      <p className="mt-6 border-t-[length:var(--edge)] border-[var(--ink)] pt-3 text-[11px] leading-relaxed text-[var(--fg-faint)]">
        No timings for this one, so it can&rsquo;t follow along.
      </p>
    </div>
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <p className="text-center text-sm leading-relaxed text-[var(--fg-faint)]">{children}</p>
    </div>
  );
}

/**
 * The correction bar above the words.
 *
 * Two fixes, because there are two ways LRCLIB is wrong and they need different
 * answers. **The wrong song entirely** — a cover, a live version, a different
 * edit — is fixed by choosing another record. **The right words at the wrong
 * moment** — usually an upload with a longer intro — is fixed by shifting the
 * timing, and no amount of choosing will help.
 *
 * Collapsed by default. Someone reading lyrics is reading, not administering
 * them, and a row of controls over the first line would be in the way of the
 * thing it exists to improve.
 */
function LyricsToolbar({
  song,
  prefKey,
  lyrics,
  offset,
  open,
  onToggle,
  synced,
}: {
  song: Song | null;
  prefKey: string;
  lyrics: Lyrics | null;
  offset: number;
  open: boolean;
  onToggle: () => void;
  synced: boolean;
}) {
  /*
   * Stored with the song it belongs to, so a stale list is simply not returned
   * when the track changes — and "loading" is derived from having no answer
   * yet rather than being a second flag set on the way into the effect.
   */
  const [found, setFound] = useState<{ key: string; list: Alternative[] } | null>(null);

  // Fetched when the panel opens, never on a track change: the ordinary case
  // is never opening this at all, and it would double every song's requests.
  useEffect(() => {
    if (!open || !song || found?.key === prefKey) return;

    const aborter = new AbortController();

    const params = new URLSearchParams({
      title: song.title,
      artist: song.artists[0] ?? "",
      alternatives: "1",
    });

    fetch(`/api/lyrics?${params}`, { signal: aborter.signal })
      .then((response) =>
        response.ok ? (response.json() as Promise<{ alternatives: Alternative[] }>) : null,
      )
      .then((data) => setFound({ key: prefKey, list: data?.alternatives ?? [] }))
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setFound({ key: prefKey, list: [] });
      });

    return () => aborter.abort();
  }, [open, song, prefKey, found]);

  const alternatives = found?.key === prefKey ? found.list : null;
  const loading = open && alternatives === null;

  return (
    <div className="shrink-0 border-b-[length:var(--edge)] border-[var(--ink)]">
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--fg-faint)]">
          {lyrics ? `${lyrics.matchedArtist} — ${lyrics.matchedTitle}` : "LRCLIB"}
        </span>

        {offset !== 0 && (
          <span className="shrink-0 rounded-[var(--r-full)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[var(--fg-dim)]">
            {offset > 0 ? "+" : ""}
            {offset.toFixed(1)}s
          </span>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="press shrink-0 rounded-[var(--r-sm)] px-2 py-1 text-[11px] font-bold text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
        >
          Wrong lyrics?
          <ChevronIcon className={`ml-1 inline size-3 transition ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div className="border-t-[length:var(--edge)] border-[var(--ink)] px-3 pb-3 pt-2">
          {synced && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
                Timing
              </span>
              {/* Half a second a step: smaller is imperceptible against a line
                  that lasts three, larger overshoots on the first press. */}
              <button
                type="button"
                onClick={() => setLyricsOffset(prefKey, offset - 0.5)}
                aria-label="Lyrics are early — delay them"
                className="slab-sm press rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-bold"
              >
                −0.5s
              </button>
              <button
                type="button"
                onClick={() => setLyricsOffset(prefKey, offset + 0.5)}
                aria-label="Lyrics are late — bring them forward"
                className="slab-sm press rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-bold"
              >
                +0.5s
              </button>
              {offset !== 0 && (
                <button
                  type="button"
                  onClick={() => setLyricsOffset(prefKey, 0)}
                  className="press rounded-[var(--r-sm)] px-2 py-1 text-[11px] font-semibold text-[var(--fg-faint)] hover:text-[var(--fg)]"
                >
                  Reset
                </button>
              )}
            </div>
          )}

          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            Other versions
          </p>

          {loading && <p className="px-1 py-2 text-[11px] text-[var(--fg-faint)]">Looking…</p>}

          {alternatives?.length === 0 && !loading && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">
              LRCLIB has only this one. Nothing else to switch to.
            </p>
          )}

          <div className="scroller-quiet max-h-48 overflow-y-auto">
            {alternatives?.map((option) => {
              const chosen = lyrics?.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLyricsId(prefKey, chosen ? undefined : option.id)}
                  className="flex w-full items-start gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">
                      {option.trackName}
                    </span>
                    <span className="block truncate text-[10px] text-[var(--fg-dim)]">
                      {[
                        option.artistName,
                        option.albumName,
                        option.duration ? `${Math.floor(option.duration / 60)}:${String(option.duration % 60).padStart(2, "0")}` : null,
                        option.synced ? "synced" : "plain",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {chosen && <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />}
                </button>
              );
            })}
          </div>

          {(lyrics?.id || offset !== 0) && (
            <button
              type="button"
              onClick={() => clearLyricsPref(prefKey)}
              className="press mt-2 w-full rounded-[var(--r-sm)] px-2 py-1.5 text-[11px] font-semibold text-[var(--fg-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
            >
              Use the automatic match again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
