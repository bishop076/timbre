"use client";

import { useEffect, useRef, useState } from "react";

import { scrollBehavior } from "../a11y/motion";
import { formatClock } from "../duration";
import { ChevronIcon, CheckIcon, InfoIcon } from "../icons";
import type { Song } from "../types";
import {
  clearLyricsPref,
  setLyricsId,
  setLyricsOffset,
  setLyricsProvider,
  songKey,
  useLyricsPref,
} from "./lyrics-prefs";
import {
  activeProvider,
  artTrackIds,
  busySeconds,
  hasYouTube,
  isScrollKey,
  matchQuality,
  PROVIDER_NAMES,
  readAnswer,
  readScroll,
  retryDelayMs,
  scrollSettleMs,
  type Lyrics,
  type LyricsAnswer,
  type LyricsProvider,
  type MatchQuality,
} from "./lyrics-source";
import { Empty, useJson } from "./panel-tabs";
import { usePlayer } from "./player-context";

interface Alternative {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  synced: boolean;
}

interface Alternatives {
  alternatives: Alternative[];
  busyFor?: number;
  failed?: boolean;
}

const NUDGES = [
  { step: -0.5, text: "−0.5s", label: "Lyrics are early — delay them" },
  { step: 0.5, text: "+0.5s", label: "Lyrics are late — bring them forward" },
];

function lyricsUrl(
  song: Song | null,
  provider: LyricsProvider,
  playing: string | null,
  chosenId: number | undefined,
): string | null {
  if (!song) return null;
  const params = new URLSearchParams({ title: song.title, artist: song.artists[0] ?? "" });

  if (provider === "ytmusic") {
    for (const id of artTrackIds(song.sources, playing)) params.append("id", id);
    return `/api/lyrics/ytmusic?${params}`;
  }

  if (song.album) params.set("album", song.album);
  if (song.durationMs) params.set("duration", String(Math.round(song.durationMs / 1000)));
  if (chosenId) params.set("id", String(chosenId));
  return `/api/lyrics?${params}`;
}

async function readLyrics(response: Response): Promise<LyricsAnswer> {
  const body: unknown = await response.json().catch(() => null);
  return readAnswer(response.status, response.headers.get("retry-after"), body);
}

function lyricsRetry(answer: LyricsAnswer): number | null {
  return answer.kind === "busy" ? retryDelayMs(answer.retryAfterSeconds) : null;
}

async function readAlternatives(response: Response): Promise<Alternatives | null> {
  const busyFor = busySeconds(response.status, response.headers.get("retry-after"));
  if (busyFor !== null) return { alternatives: [], busyFor };
  // A refusal is not an empty list. Reading one as `null` let it fall through to `?? []` and
  // the panel then said "LRCLIB has only this one" about a lookup that never completed —
  // stating as fact the very thing the request failed to establish.
  return response.ok ? response.json() : { alternatives: [], failed: true };
}

function alternativesRetry(found: Alternatives): number | null {
  return found.busyFor ? retryDelayMs(found.busyFor) : null;
}

export function LyricsPanel() {
  const { current, position, seek, videoId, activeSource } = usePlayer();

  const prefKey = current ? songKey(current.title, current.artists[0] ?? "") : "";
  const pref = useLyricsPref(prefKey);

  const playing = activeSource === "ytmusic" ? videoId : null;
  const youtube = current ? hasYouTube(current.sources, playing) : false;
  const provider = activeProvider(pref.provider, youtube);
  const other = youtube ? (provider === "ytmusic" ? "lrclib" : "ytmusic") : null;

  const url = lyricsUrl(current, provider, playing, pref.id);
  const { data, loading, retry } = useJson(url, readLyrics, lyricsRetry);
  const answer: LyricsAnswer | null = data ?? (loading || !url ? null : { kind: "failed" });
  const lyrics = answer?.kind === "found" ? answer.lyrics : null;
  const quality: MatchQuality =
    lyrics && current
      ? matchQuality({ title: current.title, artist: current.artists[0] ?? "" }, lyrics)
      : "unknown";
  const [fixing, setFixing] = useState(false);
  const [following, setFollowing] = useState(true);

  // Both are about one song and neither was keyed to one. Scrolling the lyrics away from the
  // active line and letting the track change inside the 6s resume window opened the next
  // song's lyrics already unfollowed, behind a "Follow the song" button nobody had asked for;
  // and the "Wrong lyrics?" drawer stayed open across the change, firing an
  // `alternatives=1` request for a song the reader had not questioned. Adjusting state during
  // render when the song it belongs to changes is React's own answer to this, and it settles
  // before anything paints.
  const [scopedTo, setScopedTo] = useState(prefKey);
  if (scopedTo !== prefKey) {
    setScopedTo(prefKey);
    setFixing(false);
    setFollowing(true);
  }

  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // When our own last `scrollTo` went out, and which request's lines the box has been placed
  // for. Keyed on the request rather than the song: picking another version from the drawer
  // replaces every line while the song stays put.
  const scrolledAt = useRef<number | null>(null);
  const placedFor = useRef<string | null>(null);

  const lines = lyrics?.synced ?? null;
  const offset = pref.offset ?? 0;
  const activeIndex = lines?.findLastIndex((line) => line.at <= position + offset) ?? -1;

  useEffect(() => {
    if (!following || activeIndex < 0) return;

    const box = container.current;
    const line = activeLine.current;
    if (!box || !line) return;

    // The first placement in a new set of lines is instant. The scroller arrives filled and at
    // the top, so gliding from there to the current line is a lurch nobody asked for — and on a
    // song resumed near its end it is a long one, running the whole lyric past the reader.
    const behavior = placedFor.current === url ? scrollBehavior() : "auto";
    placedFor.current = url;
    scrolledAt.current = Date.now();

    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior,
    });
  }, [activeIndex, following, url]);

  function onUserScroll() {
    setFollowing(false);
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setFollowing(true), 6_000);
  }

  // `wheel` and `touchmove` were the only two ways of moving the box the panel noticed, so a
  // scrollbar drag, a trackpad's momentum, a two-finger swipe read as `scroll` and every keyboard
  // page were answered by dragging the view back to the current line. `scroll` hears all of them;
  // the window is what keeps it from hearing our own smooth scroll and calling it the reader's.
  function onBoxScroll() {
    const read = readScroll(Date.now(), scrolledAt.current, scrollSettleMs(scrollBehavior()));
    scrolledAt.current = read.scrolledAt;
    if (read.reader) onUserScroll();
  }

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  if (!url) return <Empty>Nothing is playing.</Empty>;
  if (loading && !answer) return <Empty>Looking for lyrics…</Empty>;

  if (!lyrics || (lyrics.instrumental && !lyrics.plain && !lines)) {
    const unreachable = answer?.kind === "failed";
    return (
      <Empty>
        {answer?.kind === "busy"
          ? `${PROVIDER_NAMES[provider]} is busy right now. Trying again shortly.`
          : unreachable
            ? // Not "no lyrics for this track". Nothing was reached that could have said so, and
              // the difference is the whole point of the 502 the route now sends for an outage.
              `${PROVIDER_NAMES[provider]} couldn’t be reached, so there’s no telling whether it has the words to this one.`
            : lyrics?.instrumental
              ? "This one is instrumental."
              : provider === "ytmusic"
                ? "YouTube Music has no lyrics for this track."
                : "No lyrics found for this track."}
        {(unreachable || other) && (
          <>
            <br />
            <span className="mt-3 inline-flex flex-wrap justify-center gap-2">
              {unreachable && (
                <button
                  type="button"
                  onClick={retry}
                  className="slab-sm press rounded-[var(--r-full)] bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-bold text-[var(--fg)]"
                >
                  Try again
                </button>
              )}
              {other && (
                <button
                  type="button"
                  onClick={() => setLyricsProvider(prefKey, other)}
                  className="slab-sm press rounded-[var(--r-full)] bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-bold text-[var(--fg)]"
                >
                  Try {PROVIDER_NAMES[other]}
                </button>
              )}
            </span>
          </>
        )}
      </Empty>
    );
  }

  const synced = lines !== null && lines.length > 0;

  return (
    <>
      <LyricsToolbar
        song={current}
        prefKey={prefKey}
        lyrics={lyrics}
        provider={provider}
        youtubeAvailable={youtube}
        chosenId={pref.id}
        offset={synced ? offset : 0}
        open={fixing}
        onToggle={() => setFixing((was) => !was)}
        synced={synced}
      />
      <MatchNotice quality={quality} lyrics={lyrics} onPickAnother={() => setFixing(true)} />
      {synced ? (
        <div
          ref={container}
          onWheel={onUserScroll}
          onTouchMove={onUserScroll}
          onScroll={onBoxScroll}
          onKeyDown={(event) => {
            if (isScrollKey(event.key)) onUserScroll();
          }}
          className="scroller-quiet relative min-h-0 flex-1 overflow-y-auto px-4 py-[38vh] sm:px-5"
        >
          {lines.map((line, index) => (
            <button
              key={`${line.at}-${index}`}
              ref={index === activeIndex ? activeLine : undefined}
              type="button"
              // Colour and opacity are the whole of the old distinction, and neither survives a
              // screen reader, a high-contrast mode or a reader who cannot separate the two
              // greys. The rule down the left edge, the wash behind the line and the heavier
              // weight are three more, and `aria-current` is the one that can be spoken.
              aria-current={index === activeIndex ? "true" : undefined}
              aria-label={line.text ? undefined : "Instrumental break"}
              title={`Jump to ${formatClock(line.at)}`}
              onClick={() => seek(line.at)}
              className={`block w-full border-l-[3px] py-2 pl-3 text-left text-lg font-bold leading-snug transition-all duration-500 ease-[var(--ease)] sm:py-2.5 sm:text-xl @lg:text-[1.6rem] ${
                index === activeIndex
                  ? "rounded-r-[var(--r-sm)] border-[var(--accent)] bg-[var(--accent-wash)] font-extrabold text-[var(--fg)] opacity-100"
                  : index < activeIndex
                    ? "border-transparent text-[var(--fg-dim)] opacity-35 hover:opacity-60"
                    : "border-transparent text-[var(--fg-dim)] opacity-55 hover:opacity-85"
              }`}
            >
              {line.text || <span className="opacity-40">♪</span>}
            </button>
          ))}

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
      ) : (
        <div className="scroller-quiet min-h-0 flex-1 overflow-y-auto px-5 py-6">
          <p className="whitespace-pre-wrap text-base font-semibold leading-relaxed text-[var(--fg-dim)]">
            {lyrics.plain}
          </p>
          <p className="mt-6 border-t-[length:var(--edge)] border-[var(--ink)] pt-3 text-[11px] leading-relaxed text-[var(--fg-faint)]">
            No timings for this one, so it can&rsquo;t follow along.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Said out loud when the words on screen may not be this song's.
 *
 * `/api/lyrics` falls back to LRCLIB's search and keeps the first synced hit, so "Creep" by
 * Nirvana comes back as a complete, confidently timed "Negative Creep" — which the panel drew
 * exactly as it draws a real match, the only trace being a matched-title caption at 11px in
 * `--fg-faint` that reads like a credit. Wrong words presented as right ones are worse than an
 * empty panel, and this is the one thing the reader needs in order to distrust them.
 */
function MatchNotice({
  quality,
  lyrics,
  onPickAnother,
}: {
  quality: MatchQuality;
  lyrics: Lyrics;
  onPickAnother: () => void;
}) {
  if (quality === "exact" || quality === "unknown") return null;

  const wrongSong = quality === "different";
  const matched = lyrics.matchedArtist
    ? `${lyrics.matchedTitle} by ${lyrics.matchedArtist}`
    : lyrics.matchedTitle;

  return (
    <div
      className={`flex shrink-0 items-start gap-2 border-b-[length:var(--edge)] border-[var(--ink)] px-4 py-2 text-[11px] leading-relaxed ${
        wrongSong ? "bg-[var(--surface-2)] text-[var(--fg-dim)]" : "text-[var(--fg-faint)]"
      }`}
    >
      <InfoIcon
        aria-hidden
        className={`mt-0.5 size-3.5 shrink-0 ${wrongSong ? "text-[var(--danger)]" : ""}`}
      />
      <p className="min-w-0 flex-1">
        {wrongSong ? (
          <>
            These are the words to{" "}
            <span className="font-bold text-[var(--fg)]">{matched}</span> — the nearest thing{" "}
            {PROVIDER_NAMES.lrclib} had, <span className="font-bold text-[var(--fg)]">not this song</span>.
          </>
        ) : (
          <>
            {PROVIDER_NAMES.lrclib} credits these to{" "}
            <span className="font-bold text-[var(--fg)]">{lyrics.matchedArtist}</span>, so they may
            be another artist&rsquo;s version.
          </>
        )}{" "}
        <button
          type="button"
          onClick={onPickAnother}
          className="press whitespace-nowrap font-bold text-[var(--fg)] underline underline-offset-2"
        >
          Pick another
        </button>
      </p>
    </div>
  );
}

function LyricsToolbar({
  song,
  prefKey,
  lyrics,
  provider,
  youtubeAvailable,
  chosenId,
  offset,
  open,
  onToggle,
  synced,
}: {
  song: Song | null;
  prefKey: string;
  lyrics: Lyrics;
  provider: LyricsProvider;
  youtubeAvailable: boolean;
  chosenId: number | undefined;
  offset: number;
  open: boolean;
  onToggle: () => void;
  synced: boolean;
}) {
  const params =
    open && song
      ? new URLSearchParams({ title: song.title, artist: song.artists[0] ?? "", alternatives: "1" })
      : null;
  const { data, loading } = useJson(
    params && `/api/lyrics?${params}`,
    readAlternatives,
    alternativesRetry,
  );
  const alternatives = data?.alternatives ?? [];
  const busy = !loading && Boolean(data?.busyFor);
  const failed = !loading && Boolean(data?.failed);

  const label =
    provider === "ytmusic"
      ? [PROVIDER_NAMES.ytmusic, lyrics.attribution].filter(Boolean).join(" · ")
      : lyrics.matchedArtist
        ? `${lyrics.matchedArtist} — ${lyrics.matchedTitle ?? ""}`
        : PROVIDER_NAMES.lrclib;

  return (
    <div className="shrink-0 border-b-[length:var(--edge)] border-[var(--ink)]">
      <div className="flex items-center gap-2 px-4 py-2">
        <span title={label} className="min-w-0 flex-1 truncate text-[11px] text-[var(--fg-faint)]">
          {label}
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
              {NUDGES.map(({ step, text, label }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setLyricsOffset(prefKey, offset + step)}
                  aria-label={label}
                  className="slab-sm press rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 py-1 text-[11px] font-bold"
                >
                  {text}
                </button>
              ))}
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

          {youtubeAvailable && (
            <button
              type="button"
              onClick={() => setLyricsProvider(prefKey, provider === "ytmusic" ? "lrclib" : "ytmusic")}
              className="flex w-full items-start gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">
                  {PROVIDER_NAMES.ytmusic}
                </span>
                <span className="block truncate text-[10px] text-[var(--fg-dim)]">
                  Licensed lyrics, as YouTube Music shows them
                </span>
              </span>
              {provider === "ytmusic" && (
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-text)]" />
              )}
            </button>
          )}

          {loading && <p className="px-1 py-2 text-[11px] text-[var(--fg-faint)]">Looking…</p>}

          {busy && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">
              LRCLIB is busy right now. Its versions will be back shortly.
            </p>
          )}

          {failed && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">
              LRCLIB didn&rsquo;t answer, so there may be other versions this couldn&rsquo;t
              fetch. Closing and reopening this tries again.
            </p>
          )}

          {!loading && !busy && !failed && alternatives.length === 0 && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">
              {provider === "ytmusic"
                ? "LRCLIB has nothing for this one."
                : youtubeAvailable
                  ? "LRCLIB has only this one."
                  : "LRCLIB has only this one, and with no YouTube copy of this song there is no YouTube Music version to offer."}
            </p>
          )}

          <div className="scroller-quiet max-h-48 overflow-y-auto">
            {alternatives.map((option) => {
              const chosen = provider === "lrclib" && lyrics.id === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setLyricsId(prefKey, chosen ? undefined : option.id)}
                  className="flex w-full items-start gap-2 rounded-[var(--r-sm)] px-2 py-1.5 text-left hover:bg-[var(--surface-2)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold">{option.trackName}</span>
                    <span className="block truncate text-[10px] text-[var(--fg-dim)]">
                      {[
                        youtubeAvailable ? PROVIDER_NAMES.lrclib : null,
                        option.artistName,
                        option.albumName,
                        option.duration ? formatClock(option.duration) : null,
                        option.synced ? "synced" : "plain",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {chosen && <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent-text)]" />}
                </button>
              );
            })}
          </div>

          {(chosenId || offset !== 0 || provider === "ytmusic") && (
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
