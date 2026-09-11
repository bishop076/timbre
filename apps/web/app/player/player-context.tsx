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
import {
  insertAfter,
  moveWithin,
  removeAt as removeFromQueue,
  type QueueEdit,
} from "./queue-ops";
import { takeTrackEndStop } from "./sleep-timer.ts";
import { plausiblySameSong, sameTrack } from "./song-match";
import { forgetFailedSource, pickSource, rememberedSource } from "./source-choice";
import { isProgressive, streamUrlFor, type ProgressiveSource } from "./stream-url";
import { useTabSync } from "./use-tab-sync";
import {
  getVolumeServerSnapshot,
  getVolumeSnapshot,
  subscribeVolume,
  writeMuteToggle,
  writeVolume,
} from "./volume-store";
import { turnedAway, type YouTubeFailures } from "./youtube-refusal";

const RADIO_POOL = 50;
const RADIO_PICKS = 25;

export type PlayState = "idle" | "resolving" | "loading" | "playing" | "paused" | "unplayable";

function settled(state: PlayState): boolean {
  return state === "playing" || state === "paused";
}

export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: Song[];
  index: number;
  current: Song | null;
  videoId: string | null;
  soundcloudUrl: string | null;
  streamUrl: string | null;
  spotifyTrackId: string | null;
  subscriptionTrack: { source: "apple" | "deezer"; id: string } | null;
  mixcloudKey: string | null;
  activeSource: PlayingSource | null;
  playingPreview: boolean;
  youtubeTurnedAway: boolean;
  panelOpen: boolean;
  theater: boolean;
  state: PlayState;
  problem: string | null;
  volume: number;
  muted: boolean;
  radio: Song[];
  shuffle: boolean;
  repeat: RepeatMode;
  hasNext: boolean;
}

interface PlayerProgress {
  position: number;
  duration: number;
}

interface PlayerActions {
  play: (song: Song, rest?: Song[], prefer?: string) => void;
  enqueue: (songs: Song[]) => void;
  playNext: (songs: Song[]) => void;
  removeAt: (position: number) => void;
  move: (from: number, to: number) => void;
  clearQueue: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  handleEnded: () => void;
  handleStateChange: (state: PlayState) => void;
  handleProgress: (position: number, duration: number) => void;
  handleError: (
    reason: string,
    worthRetrying: boolean,
    options?: { stalled?: boolean; refused?: boolean },
  ) => void;
  seek: (seconds: number) => void;
  setVolume: (level: number) => void;
  toggleMute: () => void;
  togglePanel: () => void;
  toggleTheater: () => void;
  exitTheater: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  registerToggle: (fn: (() => void) | null) => void;
  registerSeek: (fn: ((seconds: number) => void) | null) => void;
}

type PlayerControls = PlayerState & PlayerActions;

const ZERO_PROGRESS: PlayerProgress = { position: 0, duration: 0 };
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

export function usePlayerProgress(): PlayerProgress {
  return useSyncExternalStore(ticks.subscribe, () => progressSnapshot, () => ZERO_PROGRESS);
}

export function usePlayer(): PlayerControls & PlayerProgress {
  const controls = usePlayerControls();
  const progress = usePlayerProgress();
  return useMemo(() => ({ ...controls, ...progress }), [controls, progress]);
}

function youtubeIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
}

function soundcloudUrlOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "soundcloud")?.url ?? null;
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

function mixcloudKeyOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "mixcloud")?.sourceId ?? null;
}

function spotifyIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "spotify")?.sourceId ?? null;
}

function progressiveOf(song: Song): { source: ProgressiveSource; sourceId: string } | null {
  const found = song.sources.find((source) => isProgressive(source.source));
  return found && isProgressive(found.source) ? { source: found.source, sourceId: found.sourceId } : null;
}

function resolvesBySearch(song: Song): boolean {
  return !youtubeIdOf(song) && !progressiveOf(song) && !mixcloudKeyOf(song) && !soundcloudUrlOf(song);
}

type PlayingSource =
  | "ytmusic"
  | "soundcloud"
  | "spotify"
  | "mixcloud"
  | "deezer"
  | "apple"
  | ProgressiveSource;

function previewOf(song: Song): { source: PlayingSource; url: string } | null {
  const found = song.sources.find((source) => Boolean(source.previewUrl));
  return found?.previewUrl ? { source: found.source as PlayingSource, url: found.previewUrl } : null;
}

type ChosenSource =
  | { kind: "youtube"; id: string }
  | { kind: "progressive"; source: ProgressiveSource; sourceId: string }
  | { kind: "mixcloud"; key: string }
  | { kind: "soundcloud"; url: string }
  | { kind: "spotify"; id: string }
  | { kind: "subscription"; source: "apple" | "deezer"; id: string }
  | { kind: "preview"; source: PlayingSource; url: string };

function chosenSource(song: Song, source: string): ChosenSource | null {
  const track = song.sources.find((entry) => entry.source === source);
  if (!track) return null;

  if (source === "ytmusic") return track.sourceId ? { kind: "youtube", id: track.sourceId } : null;
  if (source === "soundcloud") return track.url ? { kind: "soundcloud", url: track.url } : null;
  if (source === "mixcloud") return track.sourceId ? { kind: "mixcloud", key: track.sourceId } : null;
  if (source === "spotify") return track.sourceId ? { kind: "spotify", id: track.sourceId } : null;
  if (isProgressive(source)) {
    return track.sourceId ? { kind: "progressive", source, sourceId: track.sourceId } : null;
  }

  if (source === "apple" || source === "deezer") {
    if (track.sourceId) return { kind: "subscription", source, id: track.sourceId };
  }

  return track.previewUrl ? { kind: "preview", source: source as PlayingSource, url: track.previewUrl } : null;
}

export function playbackFrom(song: Song, source: string): "queue" | "manual" | "preview" | null {
  const chosen = chosenSource(song, source);
  if (!chosen) return null;
  if (chosen.kind === "spotify" || chosen.kind === "subscription") return "manual";
  if (chosen.kind === "preview") return "preview";
  return "queue";
}

interface PlayModes {
  shuffle: boolean;
  repeat: RepeatMode;
}

const MODES_KEY = "timbre:modes";

const DEFAULT_MODES: PlayModes = { shuffle: false, repeat: "off" };

function readModes(): PlayModes {
  try {
    const raw = window.localStorage.getItem(MODES_KEY);
    if (!raw) return DEFAULT_MODES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_MODES;

    const value = parsed as Partial<PlayModes>;
    return {
      shuffle: value.shuffle === true,
      repeat:
        value.repeat === "all" || value.repeat === "one" ? value.repeat : DEFAULT_MODES.repeat,
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

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Song[]>([]);
  const queueRef = useRef<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [soundcloudUrl, setSoundcloudUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [spotifyTrackId, setSpotifyTrackId] = useState<string | null>(null);
  const [subscriptionTrack, setSubscriptionTrack] = useState<{ source: "apple" | "deezer"; id: string } | null>(null);
  const [mixcloudKey, setMixcloudKey] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<PlayingSource | null>(null);
  const [playingPreview, setPlayingPreview] = useState(false);
  const [youtubeTurnedAway, setYoutubeTurnedAway] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [theater, setTheater] = useState(false);
  const [state, setState] = useState<PlayState>("idle");
  const stateRef = useRef<PlayState>("idle");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [problem, setProblem] = useState<string | null>(null);
  const [radio, setRadio] = useState<Song[]>([]);
  const { shuffle, repeat } = useLocalStore(modeStore);
  const { continueWithRadio } = usePlaybackPrefs();
  const shuffled = useRef<Set<string>>(new Set());
  const { volume, muted } = useSyncExternalStore(
    subscribeVolume,
    getVolumeSnapshot,
    getVolumeServerSnapshot,
  );

  const toggleRef = useRef<(() => void) | null>(null);
  const seekRef = useRef<((seconds: number) => void) | null>(null);
  const resolving = useRef<AbortController | null>(null);

  const songRef = useRef<Song | null>(null);
  const candidates = useRef<string[]>([]);
  const attempted = useRef<Set<string>>(new Set());
  const youtubeFailures = useRef<YouTubeFailures>({ stalled: false, refusals: 0 });
  const rescued = useRef<Set<string>>(new Set());
  const seededFor = useRef<string | null>(null);
  const radioRequest = useRef<AbortController | null>(null);

  useEffect(() => () => {
    radioRequest.current?.abort();
    seededFor.current = null;
  }, []);

  const progressiveTried = useRef(false);
  const previewTried = useRef(false);
  const soundcloudTried = useRef(false);
  const activeSourceRefSpotify = useRef<string | null>(null);
  const recorded = useRef<string | null>(null);
  const steered = useRef<string | null>(null);

  const writeQueue = useCallback((next: Song[] | ((current: Song[]) => Song[])) => {
    const value = typeof next === "function" ? next(queueRef.current) : next;
    queueRef.current = value;
    setQueue(value);
  }, []);

  const current = queue[index] ?? null;

  const attempt = useCallback((id: string) => {
    attempted.current.add(id);
    setSoundcloudUrl(null);
    setStreamUrl(null);
    setSpotifyTrackId(null);
    setSubscriptionTrack(null);
    setMixcloudKey(null);
    setPlayingPreview(false);
    setActiveSource("ytmusic");
    setVideoId(id);
    setProblem(null);
    setState("loading");
  }, []);

  const attemptSoundCloud = useCallback((url: string) => {
    soundcloudTried.current = true;
    setVideoId(null);
    setStreamUrl(null);
    setSpotifyTrackId(null);
    setSubscriptionTrack(null);
    setMixcloudKey(null);
    setPlayingPreview(false);
    setActiveSource("soundcloud");
    setSoundcloudUrl(url);
    setProblem(null);
    setState("loading");
  }, []);

  const attemptMixcloud = useCallback((key: string) => {
    setVideoId(null);
    setSoundcloudUrl(null);
    setStreamUrl(null);
    setSpotifyTrackId(null);
    setSubscriptionTrack(null);
    setPlayingPreview(false);
    setActiveSource("mixcloud");
    setMixcloudKey(key);
    setProblem(null);
    setState("loading");
  }, []);

  const attemptSpotify = useCallback((trackId: string) => {
    setVideoId(null);
    setSoundcloudUrl(null);
    setStreamUrl(null);
    setMixcloudKey(null);
    setSubscriptionTrack(null);
    setPlayingPreview(false);
    setActiveSource("spotify");
    setSpotifyTrackId(trackId);
    activeSourceRefSpotify.current = trackId;
    setProblem(null);
    setState("loading");
  }, []);

  const attemptSubscription = useCallback((source: "apple" | "deezer", id: string) => {
    setVideoId(null);
    setSoundcloudUrl(null);
    setStreamUrl(null);
    setMixcloudKey(null);
    setSpotifyTrackId(null);
    setPlayingPreview(false);
    setActiveSource(source);
    setSubscriptionTrack({ source, id });
    setProblem(
      source === "apple"
        ? "Apple Music plays this one — press it to start. Signed-in subscribers get the whole song."
        : "Deezer plays this one — press it to start. Signed-in subscribers get the whole song.",
    );
    setState("paused");
  }, []);

  const attemptPreview = useCallback((source: PlayingSource, url: string) => {
    setVideoId(null);
    setSoundcloudUrl(null);
    setSpotifyTrackId(null);
    setSubscriptionTrack(null);
    setMixcloudKey(null);
    setActiveSource(source);
    setStreamUrl(url);
    setPlayingPreview(true);
    previewTried.current = true;
    setProblem("Only a 30-second preview — nothing can play this one in full.");
    setState("loading");
  }, []);

  const attemptProgressive = useCallback((source: ProgressiveSource, sourceId: string) => {
    setVideoId(null);
    setSoundcloudUrl(null);
    setSpotifyTrackId(null);
    setSubscriptionTrack(null);
    setMixcloudKey(null);
    setPlayingPreview(false);
    setActiveSource(source);
    setStreamUrl(streamUrlFor(source, sourceId));
    progressiveTried.current = true;
    setProblem(null);
    setState("loading");
  }, []);

  const findMatches = useCallback(async (song: Song, signal: AbortSignal) => {
    const query = [song.title, song.artists[0]].filter(Boolean).join(" ");
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`, { signal });
    if (!response.ok) throw new Error("search failed");
    const data = (await response.json()) as SongsResponse;
    return data.songs.filter((found) => plausiblySameSong(song, found));
  }, []);

  const findCandidates = useCallback(
    async (song: Song, signal: AbortSignal) =>
      (await findMatches(song, signal)).map(youtubeIdOf).filter((id): id is string => id !== null),
    [findMatches],
  );

  const warmed = useRef(new Map<string, { matches: Promise<Song[]>; aborter: AbortController }>());

  const matchesFor = useCallback(
    (song: Song, signal: AbortSignal): Promise<Song[]> => {
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
    },
    [findMatches],
  );

  const adoptElsewhere = useCallback(
    (song: Song, matches: Song[], { mixcloud }: { mixcloud: boolean }): boolean => {
      if (rescued.current.has(song.id)) return false;

      const keyOf = (match: Song) => (mixcloud ? mixcloudKeyOf(match) : null);
      const elsewhere = matches.find(
        (match) =>
          progressiveOf(match) ?? keyOf(match) ?? soundcloudUrlOf(match) ?? spotifyIdOf(match),
      );
      if (!elsewhere) return false;

      rescued.current.add(song.id);
      const repaired: Song = {
        ...song,
        sources: elsewhere.sources,
        durationMs: song.durationMs ?? elsewhere.durationMs,
      };
      songRef.current = repaired;
      writeQueue((current) => current.map((entry) => (entry.id === song.id ? repaired : entry)));
      const repairedLists = addSourcesToSong(song.id, elsewhere.sources);
      if (repairedLists > 0) {
        log("info", `“${song.title}” now carries a working copy in ${repairedLists} saved playlist${repairedLists === 1 ? "" : "s"}`);
      }

      const progressive = progressiveOf(repaired);
      if (progressive) {
        attemptProgressive(progressive.source, progressive.sourceId);
        return true;
      }
      const key = keyOf(repaired);
      if (key) {
        attemptMixcloud(key);
        return true;
      }
      const soundcloud = soundcloudUrlOf(repaired);
      if (soundcloud) {
        attemptSoundCloud(soundcloud);
        return true;
      }
      const spotify = spotifyIdOf(repaired);
      if (spotify) {
        attemptSpotify(spotify);
        return true;
      }
      return false;
    },
    [attemptMixcloud, attemptProgressive, attemptSoundCloud, attemptSpotify, writeQueue],
  );

  const load = useCallback(
    async (song: Song, prefer?: string) => {
      resolving.current?.abort();
      const aborter = new AbortController();
      resolving.current = aborter;

      if (songRef.current?.id !== song.id) {
        radioRequest.current?.abort();
        seededFor.current = null;
      }
      songRef.current = song;
      candidates.current = [];
      attempted.current = new Set();
      youtubeFailures.current = { stalled: false, refusals: 0 };
      setYoutubeTurnedAway(false);
      progressiveTried.current = false;
      previewTried.current = false;
      soundcloudTried.current = false;
      setPlayingPreview(false);
      activeSourceRefSpotify.current = null;
      recorded.current = null;
      steered.current = null;
      writeProgress(0, song.durationMs ? song.durationMs / 1000 : 0);
      setActiveSource(null);
      setVideoId(null);
      setSoundcloudUrl(null);
      setStreamUrl(null);
      setSpotifyTrackId(null);
      setSubscriptionTrack(null);
      setMixcloudKey(null);

      prefer ??= rememberedSource(song);
      if (prefer && prefer !== "ytmusic") {
        const chosen = chosenSource(song, prefer);
        if (chosen) {
          steered.current = prefer;
          switch (chosen.kind) {
            case "progressive":
              attemptProgressive(chosen.source, chosen.sourceId);
              return;
            case "mixcloud":
              attemptMixcloud(chosen.key);
              return;
            case "soundcloud":
              attemptSoundCloud(chosen.url);
              return;
            case "spotify":
              attemptSpotify(chosen.id);
              return;
            case "subscription":
              attemptSubscription(chosen.source, chosen.id);
              return;
            case "preview":
              attemptPreview(chosen.source, chosen.url);
              return;
            case "youtube":
              break;
          }
        }
      }

      const direct = youtubeIdOf(song);
      if (direct) {
        attempt(direct);

        void findCandidates(song, aborter.signal)
          .then((found) => {
            if (songRef.current === song) candidates.current = found;
          })
          .catch(() => {
          });
        return;
      }

      const progressive = progressiveOf(song);
      if (progressive) {
        attemptProgressive(progressive.source, progressive.sourceId);
        return;
      }

      const mixcloud = mixcloudKeyOf(song);
      if (mixcloud) {
        attemptMixcloud(mixcloud);
        return;
      }

      const soundcloud = soundcloudUrlOf(song);
      if (soundcloud) {
        attemptSoundCloud(soundcloud);
        return;
      }

      const spotify = spotifyIdOf(song);

      setState("resolving");
      setProblem(null);

      try {
        const matches = await matchesFor(song, aborter.signal);
        candidates.current = matches.map(youtubeIdOf).filter((id): id is string => id !== null);
        const first = candidates.current[0];
        if (first) {
          attempt(first);
          return;
        }

        if (adoptElsewhere(song, matches, { mixcloud: true })) return;

        if (spotify) {
          log("warn", `“${song.title}” fell back to Spotify's embed — nothing else could play it`);
          attemptSpotify(spotify);
          return;
        }

        const preview = previewOf(song);
        if (preview) {
          attemptPreview(preview.source, preview.url);
          return;
        }

        setVideoId(null);
        setState("unplayable");
        setProblem("No copy of this song exists on YouTube Music.");
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setVideoId(null);
        setState("unplayable");
        setProblem("Couldn't find a playable copy.");
      }
    },
    [
      adoptElsewhere,
      attempt,
      attemptMixcloud,
      attemptProgressive,
      attemptSoundCloud,
      attemptSubscription,
      attemptSpotify,
      attemptPreview,
      findCandidates,
      matchesFor,
    ],
  );

  const restart = useCallback((ended: boolean) => {
    recorded.current = null;
    seekRef.current?.(0);
    if (ended || stateRef.current !== "playing") toggleRef.current?.();
  }, []);

  const play = useCallback(
    (song: Song, rest: Song[] = [], prefer?: string) => {
      if (prefer) pickSource(song, prefer, playbackFrom(song, prefer));
      const others = rest.filter((candidate) => candidate.id !== song.id);
      const loaded = songRef.current;

      if (prefer && rest.length === 0 && loaded?.id === song.id) {
        void load(song, prefer);
        return;
      }

      writeQueue([song, ...others]);
      setIndex(0);
      if (!prefer && loaded?.id === song.id && settled(stateRef.current)) {
        restart(false);
        return;
      }
      void load(song, prefer);
    },
    [load, restart, writeQueue],
  );

  const goTo = useCallback(
    (nextIndex: number) => {
      const target = queueRef.current[nextIndex];
      if (!target) return;
      setIndex(nextIndex);
      if (target.id === songRef.current?.id && settled(stateRef.current)) {
        restart(false);
        return;
      }
      void load(target);
    },
    [load, restart],
  );

  const unqueued = useCallback(
    (additions: Song[]) =>
      additions.filter((song) => !queue.some((queued) => sameTrack(queued, song))),
    [queue],
  );

  const unplayed = useCallback(
    () =>
      queue
        .map((song, position) => ({ song, position }))
        .filter(({ song, position }) => position !== index && !shuffled.current.has(song.id)),
    [queue, index],
  );

  const nextIndex = useCallback((): number | null => {
    if (queue.length === 0) return null;

    if (shuffle) {
      const pool = unplayed();
      if (pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)]!.position;
      }
      if (repeat === "all") {
        shuffled.current = new Set();
        return queue.length > 1 ? (index + 1) % queue.length : index;
      }
      return null;
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
      const playing = queue[index];
      if (playing) shuffled.current.add(playing.id);

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

      writeQueue((current) => [...current, ...fresh]);
      setRadio([]);
      goTo(queue.length);
    },
    [continueWithRadio, goTo, index, nextIndex, queue, radio, restart, unqueued, writeQueue],
  );

  const next = useCallback(() => advance(false), [advance]);

  const previous = useCallback(() => goTo(Math.max(0, index - 1)), [goTo, index]);

  const toggleShuffle = useCallback(() => {
    const modes = modeStore.getSnapshot();
    shuffled.current = new Set();
    modeStore.save({ ...modes, shuffle: !modes.shuffle });
  }, []);

  const cycleRepeat = useCallback(() => {
    const modes = modeStore.getSnapshot();
    const mode: RepeatMode =
      modes.repeat === "off" ? "all" : modes.repeat === "all" ? "one" : "off";
    modeStore.save({ ...modes, repeat: mode });
  }, []);

  const stop = useCallback(() => {
    resolving.current?.abort();
    radioRequest.current?.abort();
    seededFor.current = null;
    songRef.current = null;
    setVideoId(null);
    setSoundcloudUrl(null);
    setStreamUrl(null);
    setSpotifyTrackId(null);
    setSubscriptionTrack(null);
    setMixcloudKey(null);
    setPlayingPreview(false);
    setActiveSource(null);
    setState("idle");
    setProblem(null);
    writeProgress(0, 0);
  }, []);

  const notQueued = useCallback((additions: Song[]) => {
    const fresh: Song[] = [];
    for (const song of additions) {
      if (queueRef.current.some((queued) => sameTrack(queued, song))) continue;
      if (fresh.some((added) => sameTrack(added, song))) continue;
      fresh.push(song);
    }
    return fresh;
  }, []);

  const enqueue = useCallback(
    (songs: Song[]) => {
      const fresh = notQueued(songs);
      if (fresh.length === 0) return;

      if (queueRef.current.length === 0) {
        writeQueue(fresh);
        setIndex(0);
        void load(fresh[0]!);
        return;
      }

      writeQueue((current) => [...current, ...fresh]);
    },
    [load, notQueued, writeQueue],
  );

  const applyEdit = useCallback(
    (edit: QueueEdit | null) => {
      if (!edit) return;
      writeQueue(edit.queue);
      setIndex(edit.index);
      if (edit.stopped) stop();
      else if (edit.play) void load(edit.play);
    },
    [load, stop, writeQueue],
  );

  const removeAt = useCallback(
    (position: number) => {
      const song = queue[position];
      if (!song) return;
      shuffled.current.delete(song.id);
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
      const existing = songs.length === 1 ? songs[0]! : null;
      const at = existing
        ? queue.findIndex((queued) => sameTrack(queued, existing))
        : -1;

      if (at !== -1) {
        if (at === index || at === index + 1) return;
        applyEdit(moveWithin(queue, index, at, at < index ? index : index + 1));
        return;
      }

      applyEdit(insertAfter(queueRef.current, index, notQueued(songs)));
    },
    [applyEdit, index, notQueued, queue],
  );

  const clearQueue = useCallback(() => {
    writeQueue((current) => current.slice(0, index + 1));
  }, [index, writeQueue]);

  const indexRef = useRef(index);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    const song = queue[index];
    if (!song || !activeSource) return;
    if (seededFor.current === song.id) return;
    seededFor.current = song.id;

    const seed = activeSource === "ytmusic" ? videoId : null;

    const params = new URLSearchParams({ title: song.title, limit: String(RADIO_POOL) });
    if (seed) params.set("id", seed);
    const artist = song.artists[0];
    if (artist) params.set("artist", artist);

    const aborter = new AbortController();
    radioRequest.current?.abort();
    radioRequest.current = aborter;
    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => {
        if (aborter.signal.aborted || songRef.current?.id !== song.id) return;
        const songs = data?.songs ?? [];

        const queued = queueRef.current;

        const drawn = drawRadio(songs, {
          count: RADIO_PICKS,
          exclude: queued,
          avoid: getHistorySnapshot(),
        });

        if (indexRef.current < queued.length - 1 || !getPlaybackPrefs().continueWithRadio) {
          setRadio(drawn);
          return;
        }

        setRadio([]);
        if (drawn.length > 0) writeQueue((current) => [...current, ...drawn]);
      })
      .catch(() => {
      });

    return () => {
      if (songRef.current?.id !== song.id) aborter.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, videoId, streamUrl, soundcloudUrl, mixcloudKey, spotifyTrackId]);

  useEffect(() => {
    const upcoming = shuffle
      ? undefined
      : (queue[index + 1] ??
        (index === queue.length - 1 && continueWithRadio && repeat !== "all" ? unqueued(radio)[0] : undefined));

    for (const [id, early] of warmed.current) {
      if (id === upcoming?.id) continue;
      early.aborter.abort();
      warmed.current.delete(id);
    }
    if (!upcoming) return;

    if (resolvesBySearch(upcoming) && !warmed.current.has(upcoming.id)) {
      const aborter = new AbortController();
      const matches = findMatches(upcoming, aborter.signal);
      matches.catch(() => undefined);
      warmed.current.set(upcoming.id, { matches, aborter });
    }

    const progressive = youtubeIdOf(upcoming) ? null : progressiveOf(upcoming);
    if (!progressive) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.muted = true;
    audio.src = streamUrlFor(progressive.source, progressive.sourceId);
    return () => {
      audio.removeAttribute("src");
      audio.load();
    };
  }, [continueWithRadio, findMatches, index, queue, radio, repeat, shuffle, unqueued]);

  useEffect(() => {
    const pending = warmed.current;
    return () => {
      for (const early of pending.values()) early.aborter.abort();
      pending.clear();
    };
  }, []);

  const toggle = useCallback(() => toggleRef.current?.(), []);
  const seek = useCallback((seconds: number) => seekRef.current?.(seconds), []);

  const setVolume = useCallback((level: number) => writeVolume(level), []);
  const toggleMute = useCallback(() => writeMuteToggle(), []);
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
      if (next !== "playing") return;

      const song = queue[index];
      if (!song || recorded.current === song.id) return;
      recorded.current = song.id;

      const handle = playedHandle(song, activeSource, videoId);

      recordPlay({
        id: song.id,
        title: song.title,
        artists: song.artists,
        artworkUrl: song.artworkUrl,
        videoId,
        source: handle?.source,
        sourceId: handle?.sourceId,
        url: handle?.url ?? null,
        from: song.from,
      });
    },
    [queue, index, videoId, activeSource],
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

      const onYouTube = song?.sources.some((source) => source.source === "ytmusic") ?? false;

      if (!worthRetrying || !song) {
        log("error", `Gave up on ${song ? `“${song.title}”` : "playback"}: ${reason}`);
        setState("unplayable");
        setProblem(reason);
        return;
      }

      setState("resolving");
      try {
        const searchForCopies = onYouTube && !leftYouTube;
        const tryAnotherCopy = searchForCopies || (!leftYouTube && candidates.current.length > 0);
        if (searchForCopies && candidates.current.length === 0) {
          resolving.current?.abort();
          const aborter = new AbortController();
          resolving.current = aborter;
          candidates.current = await findCandidates(song, aborter.signal);
        }
        const alternative = tryAnotherCopy
          ? candidates.current.find((id) => !attempted.current.has(id))
          : undefined;
        if (alternative) {
          log(
            "warn",
            `“${song.title}” fell back to another copy (${alternative}) after ${attempted.current.size}: ${reason}`,
          );
          attempt(alternative);
          return;
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }

      const progressive = progressiveOf(song);
      if (progressive && !progressiveTried.current) {
        log(
          "warn",
          `“${song.title}” fell back to ${progressive.source} after ${attempted.current.size} YouTube copies refused`,
        );
        attemptProgressive(progressive.source, progressive.sourceId);
        return;
      }

      const soundcloud = soundcloudUrlOf(song);
      if (soundcloud && !soundcloudTried.current) {
        log(
          "warn",
          `“${song.title}” fell back to SoundCloud after ${attempted.current.size} YouTube copies refused`,
        );
        attemptSoundCloud(soundcloud);
        return;
      }

      if (!rescued.current.has(song.id)) {
        try {
          resolving.current?.abort();
          const rescuing = new AbortController();
          resolving.current = rescuing;
          const matches = await findMatches(song, rescuing.signal);
          if (adoptElsewhere(song, matches, { mixcloud: false })) {
            log(
              "warn",
              `“${song.title}” was rescued onto another source — nothing it shipped with would play`,
            );
            return;
          }
        } catch (cause) {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
        }
      }

      const spotifyLast = spotifyIdOf(song);
      if (spotifyLast && activeSourceRefSpotify.current !== spotifyLast) {
        log("warn", `“${song.title}” fell back to Spotify's embed — nothing else would play it`);
        attemptSpotify(spotifyLast);
        return;
      }

      const preview = previewOf(song);
      if (preview && !previewTried.current) {
        log("warn", `“${song.title}” fell back to a ${preview.source} preview — nothing plays it in full`);
        attemptPreview(preview.source, preview.url);
        return;
      }

      log(
        "error",
        `“${song.title}” is unplayable — ${attempted.current.size} YouTube copies tried, progressive ${progressiveTried.current ? "tried" : "absent"}`,
      );
      setState("unplayable");
      setProblem(giveUpReason(attempted.current.size, progressiveTried.current, leftYouTube));
    },
    [
      adoptElsewhere,
      attempt,
      attemptPreview,
      attemptProgressive,
      attemptSoundCloud,
      attemptSpotify,
      findCandidates,
      findMatches,
    ],
  );

  const handleEnded = useCallback(() => {
    if (takeTrackEndStop()) {
      setState("paused");
      return;
    }
    if (repeat === "one") {
      restart(true);
      return;
    }
    advance(true);
  }, [advance, repeat, restart]);

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

  const value: PlayerControls = {
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
    setVolume,
    toggleMute,
    togglePanel,
    toggleTheater,
    exitTheater,
    toggleShuffle,
    cycleRepeat,
    registerToggle,
    registerSeek,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
