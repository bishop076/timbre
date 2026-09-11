"use client";

import { useEffect, useRef, useState } from "react";

import { formatClock } from "../duration";
import { ChevronIcon, CheckIcon } from "../icons";
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
  PROVIDER_NAMES,
  readAnswer,
  retryDelayMs,
  type Lyrics,
  type LyricsAnswer,
  type LyricsProvider,
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
  return response.ok ? response.json() : null;
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
  const { data, loading } = useJson(url, readLyrics, lyricsRetry);
  const answer: LyricsAnswer | null = data ?? (loading || !url ? null : { kind: "failed" });
  const lyrics = answer?.kind === "found" ? answer.lyrics : null;
  const [fixing, setFixing] = useState(false);
  const [following, setFollowing] = useState(true);

  const container = useRef<HTMLDivElement>(null);
  const activeLine = useRef<HTMLButtonElement>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const lines = lyrics?.synced ?? null;
  const offset = pref.offset ?? 0;
  const activeIndex = lines?.findLastIndex((line) => line.at <= position + offset) ?? -1;

  useEffect(() => {
    if (!following || activeIndex < 0) return;

    const box = container.current;
    const line = activeLine.current;
    if (!box || !line) return;

    box.scrollTo({
      top: line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2,
      behavior: "smooth",
    });
  }, [activeIndex, following]);

  function onUserScroll() {
    setFollowing(false);
    clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setFollowing(true), 6_000);
  }

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  if (loading && !answer) return <Empty>Looking for lyrics…</Empty>;

  if (!lyrics || (lyrics.instrumental && !lyrics.plain && !lines)) {
    return (
      <Empty>
        {answer?.kind === "busy"
          ? `${PROVIDER_NAMES[provider]} is busy right now. Trying again shortly.`
          : answer?.kind === "failed"
            ? `${PROVIDER_NAMES[provider]} did not answer.`
            : lyrics?.instrumental
              ? "This one is instrumental."
              : provider === "ytmusic"
                ? "YouTube Music has no lyrics for this track."
                : "No lyrics found for this track."}
        {other && (
          <>
            <br />
            <button
              type="button"
              onClick={() => setLyricsProvider(prefKey, other)}
              className="slab-sm press mt-3 inline-block rounded-[var(--r-full)] bg-[var(--surface-2)] px-3 py-1.5 text-[11px] font-bold text-[var(--fg)]"
            >
              Try {PROVIDER_NAMES[other]}
            </button>
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
      {synced ? (
        <div
          ref={container}
          onWheel={onUserScroll}
          onTouchMove={onUserScroll}
          className="scroller-quiet relative min-h-0 flex-1 overflow-y-auto px-4 py-[38vh] sm:px-5"
        >
          {lines.map((line, index) => (
            <button
              key={`${line.at}-${index}`}
              ref={index === activeIndex ? activeLine : undefined}
              type="button"
              onClick={() => seek(line.at)}
              className={`block w-full origin-left py-2 text-left text-lg font-extrabold leading-tight sm:py-2.5 sm:text-xl transition-all duration-500 ease-[var(--ease)] @lg:text-[1.6rem] ${
                index === activeIndex
                  ? "scale-100 text-[var(--fg)] opacity-100"
                  : index < activeIndex
                    ? "scale-[0.97] text-[var(--fg-dim)] opacity-35 hover:opacity-60"
                    : "scale-[0.97] text-[var(--fg-dim)] opacity-55 hover:opacity-85"
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
                <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />
              )}
            </button>
          )}

          {loading && <p className="px-1 py-2 text-[11px] text-[var(--fg-faint)]">Looking…</p>}

          {busy && (
            <p className="px-1 py-2 text-[11px] leading-relaxed text-[var(--fg-faint)]">
              LRCLIB is busy right now. Its versions will be back shortly.
            </p>
          )}

          {!loading && !busy && alternatives.length === 0 && (
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
                  {chosen && <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" />}
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
