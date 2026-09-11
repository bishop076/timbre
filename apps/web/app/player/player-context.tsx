"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createLocalStore, createNotifier, useLocalStore } from "../local-store.ts";
import { log } from "../logs.ts";
import { addSourcesToSong } from "../playlists/store";
import type { Song, SongsResponse } from "../types";
import { drawRadio } from "./draw-radio";
import { getHistorySnapshot, recordPlay } from "./history-store";
import { playedHandle } from "./played-handle";
import { getPlaybackPrefs, usePlaybackPrefs } from "./playback-prefs";
import { insertAfter, moveWithin, removeAt as removeFromQueue, type QueueEdit } from "./queue-ops";
import { takeTrackEndStop } from "./sleep-timer.ts";
import { plausiblySameSong, sameTrack } from "./song-match";
import { forgetFailedSource, pickSource, rememberedSource } from "./source-choice";
import { isProgressive, streamUrlFor, type ProgressiveSource } from "./stream-url";
import { useTabSync } from "./use-tab-sync";
import { useVolume, writeMuteToggle, writeVolume } from "./volume-store";
import { turnedAway, type YouTubeFailures } from "./youtube-refusal";

const RADIO_POOL = 50;
const RADIO_PICKS = 25;

export type PlayState = "idle" | "resolving" | "loading" | "playing" | "paused" | "unplayable";

export type RepeatMode = "off" | "all" | "one";

type ChosenSource =
  | { kind: "ytmusic" | "mixcloud" | "spotify"; id: string }
  | { kind: "soundcloud"; url: string }
  | { kind: "progressive"; source: ProgressiveSource; sourceId: string }
  | { kind: "subscription"; source: "apple" | "deezer"; id: string }
  | { kind: "preview"; source: string; url: string };

type PlayerControls = ReturnType<typeof usePlayerValue>;

const ZERO_PROGRESS = { position: 0, duration: 0 };
const ticks = createNotifier();
let progressSnapshot = ZERO_PROGRESS;

function writeProgress(position: number, duration: number): void {
  if (position === progressSnapshot.position && duration === progressSnapshot.duration) return;
  progressSnapshot = { position, duration };
  ticks.emit();
}

const PlayerContext = createContext<PlayerControls | null>(null);

export function usePlayerControls(): PlayerControls {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside <PlayerProvider>.");
  return context;
}

export function usePlayerProgress() {
  return useSyncExternalStore(ticks.subscribe, () => progressSnapshot, () => ZERO_PROGRESS);
}

export function usePlayer() {
  const controls = usePlayerControls();
  const progress = usePlayerProgress();
  return useMemo(() => ({ ...controls, ...progress }), [controls, progress]);
}

function settled(state: PlayState): boolean {
  return state === "playing" || state === "paused";
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function renew(ref: { current: AbortController | null }): AbortController {
  ref.current?.abort();
  ref.current = new AbortController();
  return ref.current;
}

function youtubeIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
}

function youtubeIds(songs: Song[]): string[] {
  return songs.map(youtubeIdOf).filter((id): id is string => id !== null);
}

async function findMatches(song: Song, signal: AbortSignal): Promise<Song[]> {
  const query = [song.title, song.artists[0]].filter(Boolean).join(" ");
  const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`, { signal });
  if (!response.ok) throw new Error("search failed");
  const data = (await response.json()) as SongsResponse;
  return data.songs.filter((found) => plausiblySameSong(song, found));
}

function giveUpReason(youtubeCopies: number, triedProgressive: boolean, turnedAway = false): string {
  if (turnedAway) return "YouTube refused this connection (a VPN, maybe), and nothing else could play it.";
  if (youtubeCopies > 0 && triedProgressive) {
    return `Nothing here would play — ${youtubeCopies} YouTube ${youtubeCopies === 1 ? "copy" : "copies"} refused, and the other sources failed too.`;
  }
  if (youtubeCopies > 0) {
    return youtubeCopies === 1
      ? "The only copy on YouTube wouldn't play here, and nothing else could either."
      : `None of the ${youtubeCopies} copies on YouTube would play here, and nothing else could either.`;
  }
  if (triedProgressive) return "This track wouldn't stream, and there's no copy on YouTube.";
  return "No source here could play this one.";
}

function progressiveOf(song: Song) {
  const found = song.sources.find((source) => isProgressive(source.source));
  return found && isProgressive(found.source)
    ? { kind: "progressive" as const, source: found.source, sourceId: found.sourceId }
    : null;
}

function previewOf(song: Song) {
  const found = song.sources.find((source) => Boolean(source.previewUrl));
  return found?.previewUrl
    ? { kind: "preview" as const, source: found.source, url: found.previewUrl }
    : null;
}

function chosenSource(song: Song, source: string): ChosenSource | null {
  const track = song.sources.find((entry) => entry.source === source);
  if (!track) return null;

  const id = track.sourceId;
  if (source === "soundcloud") return track.url ? { kind: "soundcloud", url: track.url } : null;
  if (source === "ytmusic" || source === "mixcloud" || source === "spotify") {
    return id ? { kind: source, id } : null;
  }
  if (isProgressive(source)) return id ? { kind: "progressive", source, sourceId: id } : null;
  if ((source === "apple" || source === "deezer") && id) return { kind: "subscription", source, id };
  return track.previewUrl ? { kind: "preview", source, url: track.previewUrl } : null;
}

function ownSource(song: Song): ChosenSource | null {
  return progressiveOf(song) ?? chosenSource(song, "mixcloud") ?? chosenSource(song, "soundcloud");
}

export function playbackFrom(song: Song, source: string): "queue" | "manual" | "preview" | null {
  const kind = chosenSource(song, source)?.kind;
  if (!kind) return null;
  if (kind === "spotify" || kind === "subscription") return "manual";
  return kind === "preview" ? "preview" : "queue";
}

function spentKey(chosen: ChosenSource): string {
  return chosen.kind === "spotify" ? `spotify:${chosen.id}` : chosen.kind;
}

function problemFor(chosen: ChosenSource): string | null {
  if (chosen.kind === "preview") return "Only a 30-second preview — nothing can play this one in full.";
  if (chosen.kind !== "subscription") return null;
  const name = chosen.source === "apple" ? "Apple Music" : "Deezer";
  return `${name} plays this one — press it to start. Signed-in subscribers get the whole song.`;
}

interface PlayModes {
  shuffle: boolean;
  repeat: RepeatMode;
}

const MODES_KEY = "timbre:modes";

const DEFAULT_MODES: PlayModes = { shuffle: false, repeat: "off" };

function readModes(): PlayModes {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(MODES_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_MODES;
    const { shuffle, repeat } = parsed as Partial<PlayModes>;
    return {
      shuffle: shuffle === true,
      repeat: repeat === "all" || repeat === "one" ? repeat : "off",
    };
  } catch {
    return DEFAULT_MODES;
  }
}

const modeStore = createLocalStore<PlayModes>({
  read: readModes,
  initial: DEFAULT_MODES,
  write: (next) => window.localStorage.setItem(MODES_KEY, JSON.stringify(next)),
});

function cycleRepeat(): void {
  const modes = modeStore.getSnapshot();
  const repeat = modes.repeat === "off" ? "all" : modes.repeat === "all" ? "one" : "off";
  modeStore.save({ ...modes, repeat });
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const value = usePlayerValue();
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

function usePlayerValue() {
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<ChosenSource | null>(null);
  const [youtubeTurnedAway, setYoutubeTurnedAway] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [theater, setTheater] = useState(false);
  const [state, setState] = useState<PlayState>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [radio, setRadio] = useState<Song[]>([]);
  const { shuffle, repeat } = useLocalStore(modeStore);
  const { continueWithRadio } = usePlaybackPrefs();
  const { volume, muted } = useVolume();

  const queueRef = useRef<Song[]>([]);
  const stateRef = useRef<PlayState>("idle");
  const indexRef = useRef(index);
  useEffect(() => {
    stateRef.current = state;
    indexRef.current = index;
  }, [state, index]);

  const shuffled = useRef<Set<string>>(new Set());
  const toggleRef = useRef<(() => void) | null>(null);
  const seekRef = useRef<((seconds: number) => void) | null>(null);
  const resolving = useRef<AbortController | null>(null);
  const radioRequest = useRef<AbortController | null>(null);
  const seededFor = useRef<string | null>(null);
  const songRef = useRef<Song | null>(null);
  const candidates = useRef<string[]>([]);
  const attempted = useRef<Set<string>>(new Set());
  const spent = useRef<Set<string>>(new Set());
  const youtubeFailures = useRef<YouTubeFailures>({ stalled: false, refusals: 0 });
  const rescued = useRef<Set<string>>(new Set());
  const recorded = useRef<string | null>(null);
  const steered = useRef<string | null>(null);
  const warmed = useRef(new Map<string, { matches: Promise<Song[]>; aborter: AbortController }>());

  const current = queue[index] ?? null;
  const activeSource = playing && ("source" in playing ? playing.source : playing.kind);
  const videoId = playing?.kind === "ytmusic" ? playing.id : null;
  const soundcloudUrl = playing?.kind === "soundcloud" ? playing.url : null;
  const mixcloudKey = playing?.kind === "mixcloud" ? playing.id : null;
  const spotifyTrackId = playing?.kind === "spotify" ? playing.id : null;
  const subscriptionTrack = playing?.kind === "subscription" ? playing : null;
  const playingPreview = playing?.kind === "preview";
  const streamUrl =
    playing?.kind === "progressive"
      ? streamUrlFor(playing.source, playing.sourceId)
      : playing?.kind === "preview"
        ? playing.url
        : null;

  const writeQueue = useCallback((next: Song[] | ((queued: Song[]) => Song[])) => {
    const value = typeof next === "function" ? next(queueRef.current) : next;
    queueRef.current = value;
    setQueue(value);
  }, []);

  const dropRadio = useCallback(() => {
    radioRequest.current?.abort();
    seededFor.current = null;
  }, []);

  useEffect(() => dropRadio, [dropRadio]);

  const start = useCallback((chosen: ChosenSource) => {
    if (chosen.kind === "ytmusic") attempted.current.add(chosen.id);
    else spent.current.add(spentKey(chosen));
    setPlaying(chosen);
    setProblem(problemFor(chosen));
    setState(chosen.kind === "subscription" ? "paused" : "loading");
  }, []);

  const matchesFor = useCallback((song: Song, signal: AbortSignal): Promise<Song[]> => {
    const early = warmed.current.get(song.id);
    if (!early) return findMatches(song, signal);
    warmed.current.delete(song.id);

    return new Promise<Song[]>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort, { once: true });
      early.matches
        .catch(() => findMatches(song, signal))
        .then(resolve, reject)
        .finally(() => signal.removeEventListener("abort", abort));
    });
  }, []);

  const adoptElsewhere = useCallback(
    (song: Song, matches: Song[], { mixcloud }: { mixcloud: boolean }): boolean => {
      if (rescued.current.has(song.id)) return false;

      const playable = (match: Song) =>
        progressiveOf(match) ??
        (mixcloud ? chosenSource(match, "mixcloud") : null) ??
        chosenSource(match, "soundcloud") ??
        chosenSource(match, "spotify");
      const elsewhere = matches.find(playable);
      const chosen = elsewhere && playable(elsewhere);
      if (!elsewhere || !chosen) return false;

      rescued.current.add(song.id);
      const repaired: Song = {
        ...song,
        sources: elsewhere.sources,
        durationMs: song.durationMs ?? elsewhere.durationMs,
      };
      songRef.current = repaired;
      writeQueue((queued) => queued.map((entry) => (entry.id === song.id ? repaired : entry)));
      const repairedLists = addSourcesToSong(song.id, elsewhere.sources);
      if (repairedLists > 0) {
        log(
          "info",
          `“${song.title}” now carries a working copy in ${repairedLists} saved playlist${repairedLists === 1 ? "" : "s"}`,
        );
      }
      start(chosen);
      return true;
    },
    [start, writeQueue],
  );

  const load = useCallback(
    async (song: Song, prefer?: string) => {
      const { signal } = renew(resolving);
      if (songRef.current?.id !== song.id) dropRadio();
      songRef.current = song;
      candidates.current = [];
      attempted.current = new Set();
      spent.current = new Set();
      youtubeFailures.current = { stalled: false, refusals: 0 };
      recorded.current = null;
      steered.current = null;
      setYoutubeTurnedAway(false);
      setPlaying(null);
      writeProgress(0, song.durationMs ? song.durationMs / 1000 : 0);

      prefer ??= rememberedSource(song);
      const named = prefer && prefer !== "ytmusic" ? chosenSource(song, prefer) : null;
      if (prefer && named) {
        steered.current = prefer;
        return start(named);
      }

      const direct = youtubeIdOf(song);
      if (direct) {
        start({ kind: "ytmusic", id: direct });
        void findMatches(song, signal)
          .then((found) => {
            if (songRef.current === song) candidates.current = youtubeIds(found);
          })
          .catch(() => {});
        return;
      }

      const own = ownSource(song);
      if (own) return start(own);

      const spotify = chosenSource(song, "spotify");
      setState("resolving");
      setProblem(null);

      try {
        const matches = await matchesFor(song, signal);
        candidates.current = youtubeIds(matches);
        const first = candidates.current[0];
        if (first) return start({ kind: "ytmusic", id: first });
        if (adoptElsewhere(song, matches, { mixcloud: true })) return;
        if (spotify) {
          log("warn", `“${song.title}” fell back to Spotify's embed — nothing else could play it`);
          return start(spotify);
        }
        const preview = previewOf(song);
        if (preview) return start(preview);

        setPlaying(null);
        setState("unplayable");
        setProblem("No copy of this song exists on YouTube Music.");
      } catch (cause) {
        if (isAbort(cause)) return;
        setPlaying(null);
        setState("unplayable");
        setProblem("Couldn't find a playable copy.");
      }
    },
    [adoptElsewhere, dropRadio, matchesFor, start],
  );

  const restart = useCallback((ended: boolean) => {
    recorded.current = null;
    seekRef.current?.(0);
    if (ended || stateRef.current !== "playing") toggleRef.current?.();
  }, []);

  const openSong = useCallback(
    (song: Song, prefer?: string) => {
      if (!prefer && song.id === songRef.current?.id && settled(stateRef.current)) restart(false);
      else void load(song, prefer);
    },
    [load, restart],
  );

  const play = useCallback(
    (song: Song, rest: Song[] = [], prefer?: string) => {
      if (prefer) pickSource(song, prefer, playbackFrom(song, prefer));
      const switchingSource = prefer && rest.length === 0 && songRef.current?.id === song.id;
      if (!switchingSource) {
        writeQueue([song, ...rest.filter((candidate) => candidate.id !== song.id)]);
        setIndex(0);
      }
      openSong(song, prefer);
    },
    [openSong, writeQueue],
  );

  const goTo = useCallback(
    (position: number) => {
      const target = queueRef.current[position];
      if (!target) return;
      setIndex(position);
      openSong(target);
    },
    [openSong],
  );

  const unqueued = useCallback(
    (additions: Song[]) =>
      additions.filter((song) => !queue.some((queued) => sameTrack(queued, song))),
    [queue],
  );

  const unplayed = useCallback(
    () =>
      queue.flatMap((song, position) =>
        position === index || shuffled.current.has(song.id) ? [] : [position],
      ),
    [queue, index],
  );

  const nextIndex = useCallback((): number | null => {
    if (queue.length === 0) return null;
    if (shuffle) {
      const pool = unplayed();
      if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
      if (repeat !== "all") return null;
      shuffled.current = new Set();
      return queue.length > 1 ? (index + 1) % queue.length : index;
    }
    if (index + 1 < queue.length) return index + 1;
    return repeat === "all" ? 0 : null;
  }, [queue, index, shuffle, repeat, unplayed]);

  const hasNext = useMemo(() => {
    if (queue.length === 0) return false;
    if (repeat === "all") return true;
    // eslint-disable-next-line react-hooks/refs
    if (shuffle ? unplayed().length > 0 : index + 1 < queue.length) return true;
    return continueWithRadio && unqueued(radio).length > 0;
  }, [continueWithRadio, index, queue, radio, repeat, shuffle, unplayed, unqueued]);

  const advance = useCallback(
    (fromEnd: boolean) => {
      if (current) shuffled.current.add(current.id);

      const target = nextIndex();
      if (target !== null) {
        if (target === index && fromEnd) restart(true);
        else goTo(target);
        return;
      }

      const fresh = continueWithRadio ? unqueued(radio) : [];
      if (fresh.length === 0) {
        if (fromEnd) setState("idle");
        return;
      }
      writeQueue((queued) => [...queued, ...fresh]);
      setRadio([]);
      goTo(queue.length);
    },
    [
      continueWithRadio,
      current,
      goTo,
      index,
      nextIndex,
      queue,
      radio,
      restart,
      unqueued,
      writeQueue,
    ],
  );

  const next = useCallback(() => advance(false), [advance]);
  const previous = useCallback(() => goTo(Math.max(0, index - 1)), [goTo, index]);

  const handleEnded = useCallback(() => {
    if (takeTrackEndStop()) setState("paused");
    else if (repeat === "one") restart(true);
    else advance(true);
  }, [advance, repeat, restart]);

  const toggleShuffle = useCallback(() => {
    const modes = modeStore.getSnapshot();
    shuffled.current = new Set();
    modeStore.save({ ...modes, shuffle: !modes.shuffle });
  }, []);

  const stop = useCallback(() => {
    resolving.current?.abort();
    dropRadio();
    songRef.current = null;
    setPlaying(null);
    setState("idle");
    setProblem(null);
    writeProgress(0, 0);
  }, [dropRadio]);

  const notQueued = useCallback((additions: Song[]) => {
    const fresh: Song[] = [];
    for (const song of additions) {
      if (![...queueRef.current, ...fresh].some((other) => sameTrack(other, song))) fresh.push(song);
    }
    return fresh;
  }, []);

  const enqueue = useCallback(
    (songs: Song[]) => {
      const fresh = notQueued(songs);
      if (fresh.length === 0) return;
      if (queueRef.current.length > 0) return writeQueue((queued) => [...queued, ...fresh]);
      writeQueue(fresh);
      setIndex(0);
      void load(fresh[0]);
    },
    [load, notQueued, writeQueue],
  );

  const applyEdit = useCallback(
    (edit: QueueEdit | null) => {
      if (!edit) return;
      writeQueue(edit.queue);
      setIndex(edit.index);
      if (edit.queue.length === 0) stop();
      else if (edit.play) void load(edit.play);
    },
    [load, stop, writeQueue],
  );

  const removeAt = useCallback(
    (position: number) => {
      const song = queue[position];
      if (song) shuffled.current.delete(song.id);
      applyEdit(removeFromQueue(queue, index, position));
    },
    [applyEdit, index, queue],
  );

  const move = useCallback(
    (from: number, to: number) => applyEdit(moveWithin(queue, index, from, to)),
    [applyEdit, index, queue],
  );

  const playNext = useCallback(
    (songs: Song[]) => {
      const at = songs.length === 1 ? queue.findIndex((queued) => sameTrack(queued, songs[0])) : -1;
      if (at === -1) applyEdit(insertAfter(queueRef.current, index, notQueued(songs)));
      else if (at !== index && at !== index + 1) {
        applyEdit(moveWithin(queue, index, at, at < index ? index : index + 1));
      }
    },
    [applyEdit, index, notQueued, queue],
  );

  const clearQueue = useCallback(() => {
    writeQueue((queued) => queued.slice(0, index + 1));
  }, [index, writeQueue]);

  useEffect(() => {
    const song = queue[index];
    if (!song || !activeSource || seededFor.current === song.id) return;
    seededFor.current = song.id;

    const params = new URLSearchParams({ title: song.title, limit: String(RADIO_POOL) });
    if (videoId) params.set("id", videoId);
    if (song.artists[0]) params.set("artist", song.artists[0]);

    const aborter = renew(radioRequest);
    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => {
        if (aborter.signal.aborted || songRef.current?.id !== song.id) return;
        const queued = queueRef.current;
        const drawn = drawRadio(data?.songs ?? [], {
          count: RADIO_PICKS,
          exclude: queued,
          avoid: getHistorySnapshot(),
        });
        const parked =
          indexRef.current < queued.length - 1 || !getPlaybackPrefs().continueWithRadio;
        setRadio(parked ? drawn : []);
        if (!parked && drawn.length > 0) writeQueue((current) => [...current, ...drawn]);
      })
      .catch(() => {});

    return () => {
      if (songRef.current?.id !== song.id) aborter.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, videoId, streamUrl, soundcloudUrl, mixcloudKey, spotifyTrackId]);

  useEffect(() => {
    const last = index === queue.length - 1;
    const upcoming = shuffle
      ? undefined
      : (queue[index + 1] ??
        (last && continueWithRadio && repeat !== "all" ? unqueued(radio)[0] : undefined));

    for (const [id, early] of warmed.current) {
      if (id === upcoming?.id) continue;
      early.aborter.abort();
      warmed.current.delete(id);
    }
    if (!upcoming || youtubeIdOf(upcoming)) return;

    if (!ownSource(upcoming) && !warmed.current.has(upcoming.id)) {
      const aborter = new AbortController();
      const matches = findMatches(upcoming, aborter.signal);
      matches.catch(() => undefined);
      warmed.current.set(upcoming.id, { matches, aborter });
    }

    const progressive = progressiveOf(upcoming);
    if (!progressive) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.muted = true;
    audio.src = streamUrlFor(progressive.source, progressive.sourceId);
    return () => {
      audio.removeAttribute("src");
      audio.load();
    };
  }, [continueWithRadio, index, queue, radio, repeat, shuffle, unqueued]);

  useEffect(() => {
    const pending = warmed.current;
    return () => {
      for (const early of pending.values()) early.aborter.abort();
      pending.clear();
    };
  }, []);

  const toggle = useCallback(() => toggleRef.current?.(), []);
  const seek = useCallback((seconds: number) => seekRef.current?.(seconds), []);

  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      if (open) setTheater(false);
      return !open;
    });
  }, []);

  const toggleTheater = useCallback(() => {
    if (!current) return;
    setPanelOpen(true);
    setTheater((expanded) => !expanded);
  }, [current]);

  const exitTheater = useCallback(() => setTheater(false), []);

  const handleStateChange = useCallback(
    (next: PlayState) => {
      setState(next);
      if (next !== "playing" || !current || recorded.current === current.id) return;
      recorded.current = current.id;

      const { id, title, artists, artworkUrl, from } = current;
      const handle = playedHandle(current, activeSource, videoId);
      recordPlay({ id, title, artists, artworkUrl, from, videoId, url: null, ...handle });
    },
    [current, videoId, activeSource],
  );

  const handleError = useCallback(
    async (
      reason: string,
      worthRetrying: boolean,
      options: { stalled?: boolean; refused?: boolean } = {},
    ) => {
      const song = songRef.current;
      if (song && steered.current) forgetFailedSource(song, steered.current);
      steered.current = null;
      const failures = youtubeFailures.current;
      const alreadyLeft = turnedAway(failures);
      if (options.stalled) failures.stalled = true;
      if (options.refused) failures.refusals += 1;
      const leftYouTube = turnedAway(failures);
      if (leftYouTube && !alreadyLeft) {
        log(
          "warn",
          `YouTube turned away the connection on “${song?.title ?? "playback"}” (${failures.stalled ? "stalled" : `${failures.refusals} uploads refused`}) — leaving YouTube`,
        );
        setYoutubeTurnedAway(true);
      }

      if (!worthRetrying || !song) {
        log("error", `Gave up on ${song ? `“${song.title}”` : "playback"}: ${reason}`);
        setState("unplayable");
        setProblem(reason);
        return;
      }

      const warn = (message: string) => log("warn", `“${song.title}” ${message}`);
      setState("resolving");
      if (!leftYouTube) {
        try {
          const onYouTube = song.sources.some((source) => source.source === "ytmusic");
          if (onYouTube && candidates.current.length === 0) {
            candidates.current = youtubeIds(await findMatches(song, renew(resolving).signal));
          }
          const alternative = candidates.current.find((id) => !attempted.current.has(id));
          if (alternative) {
            warn(
              `fell back to another copy (${alternative}) after ${attempted.current.size}: ${reason}`,
            );
            return start({ kind: "ytmusic", id: alternative });
          }
        } catch (cause) {
          if (isAbort(cause)) return;
        }
      }

      const progressive = progressiveOf(song);
      if (progressive && !spent.current.has("progressive")) {
        warn(
          `fell back to ${progressive.source} after ${attempted.current.size} YouTube copies refused`,
        );
        return start(progressive);
      }

      const soundcloud = chosenSource(song, "soundcloud");
      if (soundcloud && !spent.current.has("soundcloud")) {
        warn(`fell back to SoundCloud after ${attempted.current.size} YouTube copies refused`);
        return start(soundcloud);
      }

      if (!rescued.current.has(song.id)) {
        try {
          const matches = await findMatches(song, renew(resolving).signal);
          if (adoptElsewhere(song, matches, { mixcloud: false })) {
            warn("was rescued onto another source — nothing it shipped with would play");
            return;
          }
        } catch (cause) {
          if (isAbort(cause)) return;
        }
      }

      const spotify = chosenSource(song, "spotify");
      if (spotify && !spent.current.has(spentKey(spotify))) {
        warn("fell back to Spotify's embed — nothing else would play it");
        return start(spotify);
      }

      const preview = previewOf(song);
      if (preview && !spent.current.has("preview")) {
        warn(`fell back to a ${preview.source} preview — nothing plays it in full`);
        return start(preview);
      }

      const triedProgressive = spent.current.has("progressive");
      log(
        "error",
        `“${song.title}” is unplayable — ${attempted.current.size} YouTube copies tried, progressive ${triedProgressive ? "tried" : "absent"}`,
      );
      setState("unplayable");
      setProblem(giveUpReason(attempted.current.size, triedProgressive, leftYouTube));
    },
    [adoptElsewhere, start],
  );

  const registerToggle = useCallback((fn: (() => void) | null) => {
    toggleRef.current = fn;
  }, []);

  const registerSeek = useCallback((fn: ((seconds: number) => void) | null) => {
    seekRef.current = fn;
  }, []);

  useTabSync({
    queue,
    index,
    current,
    state,
    hasNext,
    activeSource,
    playingPreview,
    progress: () => progressSnapshot,
    play,
    toggle,
    next,
    previous,
    seek,
  });

  return {
    queue,
    index,
    current,
    videoId,
    soundcloudUrl,
    streamUrl,
    spotifyTrackId,
    subscriptionTrack,
    mixcloudKey,
    activeSource,
    playingPreview,
    youtubeTurnedAway,
    panelOpen,
    theater,
    state,
    problem,
    volume,
    muted,
    radio,
    shuffle,
    repeat,
    hasNext,
    play,
    enqueue,
    playNext,
    removeAt,
    move,
    clearQueue,
    toggle,
    next,
    previous,
    handleEnded,
    handleStateChange,
    handleProgress: writeProgress,
    handleError,
    seek,
    setVolume: writeVolume,
    toggleMute: writeMuteToggle,
    togglePanel,
    toggleTheater,
    exitTheater,
    toggleShuffle,
    cycleRepeat,
    registerToggle,
    registerSeek,
  };
}
