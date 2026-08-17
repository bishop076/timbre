"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatClock } from "../duration";
import { ChevronIcon, CheckIcon } from "../icons";
import type { Song } from "../types";
import {
  clearLyricsPref,
  setLyricsId,
  setLyricsOffset,
  songKey,
  useLyricsPref,
} from "./lyrics-prefs";
import { Empty } from "./panel-tabs";
import { usePlayer } from "./player-context";

// Lyrics that follow the music: a line is current from its own timestamp until the next,
// and the panel keeps it in view without fighting a reader who has scrolled away. LRCLIB
// often has no timings, so plain text is a first-class fallback.

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
  // Stored with its song, so "loading" is derived: a key with no answer yet.
  const [state, setState] = useState<{ key: string; lyrics: Lyrics | null } | null>(null);

  // Identity of the song, not the object: the queue hands back new objects per render.
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
    if (chosenId) params.set("id", String(chosenId));

    fetch(`/api/lyrics?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ lyrics: Lyrics | null }>) : null))
      .then((data) => setState({ key, lyrics: data?.lyrics ?? null }))
      .catch((cause: unknown) => {
        // Settle even on failure: unset kept `loading` true for the rest of the song, so
        // an offline moment showed "Looking for lyrics…" forever.
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

  // Keyed by the recording, so a fix survives the same song arriving from another source.
  const prefKey = current ? songKey(current.title, current.artists[0] ?? "") : "";
  const pref = useLyricsPref(prefKey);

  const { lyrics, loading } = useLyrics(current, pref.id);
  const [fixing, setFixing] = useState(false);

  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);

  // Stops chasing the song for a while, or the next timestamp yanks the view back.
  const [following, setFollowing] = useState(true);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lines = lyrics?.synced ?? null;

  // Applied to the playhead, not the lines: same result, no rebuilt array. A positive
  // offset means the words arrive late, so time moves to meet them.
  const at = position + (pref.offset ?? 0);

  /** The last line whose timestamp has passed. */
  const activeIndex = useMemo(() => {
    if (!lines || lines.length === 0) return -1;
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    // Binary search: hundreds of lines, re-run on every position tick.
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

    // Arithmetic, not `scrollIntoView`: that scrolls every scrollable ancestor, so the
    // whole app lurches with the panel.
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
          Padded by roughly half the pane so the first and last lines can reach the
          centre. `vh`, not `%` — percentage padding resolves against the containing
          block's *width*, so it would shrink as the panel narrowed.
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
              // Seeks to the line — the reason these are buttons, not <p>.
              onClick={() => seek(line.at)}
              // Weight and opacity rather than hue: the accent shifts with the artwork, so
              // colour-only emphasis can vanish into the tint.
              className={`block w-full origin-left py-2 text-left text-lg font-extrabold leading-tight sm:py-2.5 sm:text-xl transition-all duration-500 ease-[var(--ease)] @lg:text-[1.6rem] ${
                isActive
                  ? "scale-100 text-[var(--fg)] opacity-100"
                  : isPast
                    ? "scale-[0.97] text-[var(--fg-dim)] opacity-35 hover:opacity-60"
                    : "scale-[0.97] text-[var(--fg-dim)] opacity-55 hover:opacity-85"
              }`}
            >
              {/* A timed blank must still occupy its slot or the highlight jumps early. */}
              {line.text || <span className="opacity-40">♪</span>}
            </button>
          );
        })}

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

/**
 * The correction bar above the words, collapsed by default. Two fixes, because LRCLIB is
 * wrong in two ways: the wrong song, fixed by choosing another record, and the right words
 * at the wrong moment, fixed by shifting the timing.
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
  // Stored with its song, so a stale list is not returned when the track changes.
  const [found, setFound] = useState<{ key: string; list: Alternative[] } | null>(null);

  // On open, never on a track change: that would double every song's requests.
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
                        option.duration ? formatClock(option.duration) : null,
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
