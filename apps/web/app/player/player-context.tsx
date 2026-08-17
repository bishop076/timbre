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

import { createLocalStore, useLocalStore } from "../local-store.ts";
import type { Song, SongsResponse } from "../types";
import { recordPlay } from "./history-store";
import { moveWithin, removeAt as removeFromQueue, type QueueEdit } from "./queue-ops";
import {
  getVolumeServerSnapshot,
  getVolumeSnapshot,
  subscribeVolume,
  writeMuteToggle,
  writeVolume,
} from "./volume-store";

/*
 * The queue holds songs, not source-tracks; only YouTube Music and SoundCloud are
 * controllable. A blocked embed cannot be detected server-side — a barred upload answers
 * oEmbed with 200 and reports playableInEmbed:true — so a song carries candidate uploads.
 */

export type PlayState = "idle" | "resolving" | "loading" | "playing" | "paused" | "unplayable";

/** `off` continues into the recommendations at queue end; `all` loops the queue; `one` repeats a track. */
export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: Song[];
  index: number;
  current: Song | null;
  videoId: string | null;
  soundcloudUrl: string | null;
  /** Which player owns the current song. Exactly one is ever mounted — a paused one can be restarted by a stray event. */
  activeSource: "ytmusic" | "soundcloud" | null;
  /** Whether the now-playing panel is shown. Hiding only clips the player: the IFrame API stops playback below 200×200 (BUGS.md B-1). */
  panelOpen: boolean;
  /** Whether the panel fills the content area. Same element either way — re-parenting the iframe would reload it and kill playback. */
  theater: boolean;
  state: PlayState;
  problem: string | null;
  position: number;
  duration: number;
  /** Output level, 0–100, and mute. Held here because the player is torn down on every source switch. */
  volume: number;
  muted: boolean;
  /** What to play after the queue (`recommend.ts`). Fetched on every track change so continuing costs no round trip (BUGS.md B-5). */
  radio: Song[];
  shuffle: boolean;
  repeat: RepeatMode;
  /** Whether `next()` would do anything. Derived once here: the two transports each had their
   * own version, and they disagreed — desktop offered a Next that did nothing at queue end. */
  hasNext: boolean;
}

interface PlayerControls extends PlayerState {
  /** Plays a song, optionally queueing the list it came from behind it. */
  play: (song: Song, rest?: Song[]) => void;
  enqueue: (songs: Song[]) => void;
  removeAt: (position: number) => void;
  move: (from: number, to: number) => void;
  /** Drops everything after the current song, keeping it playing. */
  clearQueue: () => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  handleEnded: () => void;
  handleStateChange: (state: PlayState) => void;
  handleProgress: (position: number, duration: number) => void;
  /** Reports a playback failure. `worthRetrying` means the fault is this upload's, so another copy stands a chance. */
  handleError: (reason: string, worthRetrying: boolean) => void;
  seek: (seconds: number) => void;
  setVolume: (level: number) => void;
  toggleMute: () => void;
  togglePanel: () => void;
  toggleTheater: () => void;
  /** Puts the video back without toggling — navigation needs it, since the expanded video replaces the content area. */
  exitTheater: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  registerToggle: (fn: (() => void) | null) => void;
  registerSeek: (fn: ((seconds: number) => void) | null) => void;
}

const PlayerContext = createContext<PlayerControls | null>(null);

export function usePlayer(): PlayerControls {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside <PlayerProvider>.");
  return context;
}

function youtubeIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
}

/** The SoundCloud copy, if any. Returns `url`, not `sourceId` — the widget takes a permalink. */
function soundcloudUrlOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "soundcloud")?.url ?? null;
}

interface PlayModes {
  shuffle: boolean;
  repeat: RepeatMode;
}

const MODES_KEY = "timbre:modes";

/** Referentially stable, and what hydration renders against. */
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
    // Private browsing throws rather than returning null; so does malformed JSON.
    return DEFAULT_MODES;
  }
}

// No `keys`: shuffle and repeat steer *this* tab's queue, so following another tab's toggle
// would reorder playback under the listener. Volume is shared; a traversal mode is not.
const modeStore = createLocalStore<PlayModes>({
  read: readModes,
  initial: DEFAULT_MODES,
  write: (next) => window.localStorage.setItem(MODES_KEY, JSON.stringify(next)),
});

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [soundcloudUrl, setSoundcloudUrl] = useState<string | null>(null);
  const [activeSource, setActiveSource] = useState<"ytmusic" | "soundcloud" | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [theater, setTheater] = useState(false);
  const [state, setState] = useState<PlayState>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [radio, setRadio] = useState<Song[]>([]);
  // Remembered across reloads, like the volume: a listener who shuffles expects to still be
  // shuffling after a refresh.
  const { shuffle, repeat } = useLocalStore(modeStore);
  // Played in this shuffle pass. A pass restarts only once every song has played.
  const shuffled = useRef<Set<string>>(new Set());
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
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
  // The song already written to history. Held per id so a pause/resume, or a fall-through to
  // another copy, does not record twice; see `handleStateChange`.
  const recorded = useRef<string | null>(null);

  const current = queue[index] ?? null;

  const attempt = useCallback((id: string) => {
    attempted.current.add(id);
    setSoundcloudUrl(null);
    setActiveSource("ytmusic");
    setVideoId(id);
    setProblem(null);
    setState("loading");
  }, []);

  const attemptSoundCloud = useCallback((url: string) => {
    setVideoId(null);
    setActiveSource("soundcloud");
    setSoundcloudUrl(url);
    setProblem(null);
    setState("loading");
  }, []);

  const findCandidates = useCallback(async (song: Song, signal: AbortSignal) => {
    const query = [song.title, song.artists[0]].filter(Boolean).join(" ");
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=10`, { signal });
    if (!response.ok) throw new Error("search failed");
    const data = (await response.json()) as SongsResponse;
    return data.songs.map(youtubeIdOf).filter((id): id is string => id !== null);
  }, []);

  const load = useCallback(
    async (song: Song) => {
      resolving.current?.abort();
      const aborter = new AbortController();
      resolving.current = aborter;

      songRef.current = song;
      candidates.current = [];
      attempted.current = new Set();
      // Cleared on every deliberate (re)start: repeat-one re-loads the *same* id, and the
      // per-id guard otherwise swallowed every play after the first.
      recorded.current = null;
      setPosition(0);
      setDuration(0);
      setActiveSource(null);
      setVideoId(null);
      setSoundcloudUrl(null);

      const direct = youtubeIdOf(song);
      if (direct) {
        attempt(direct);
        return;
      }

      const soundcloud = soundcloudUrlOf(song);
      if (soundcloud) {
        attemptSoundCloud(soundcloud);
        return;
      }

      setState("resolving");
      setProblem(null);

      try {
        candidates.current = await findCandidates(song, aborter.signal);
        const first = candidates.current[0];
        if (!first) {
          setVideoId(null);
          setState("unplayable");
          setProblem("No copy of this song exists on YouTube Music.");
          return;
        }
        attempt(first);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setVideoId(null);
        setState("unplayable");
        setProblem("Couldn't find a playable copy.");
      }
    },
    [attempt, attemptSoundCloud, findCandidates],
  );

  const play = useCallback(
    (song: Song, rest: Song[] = []) => {
      const others = rest.filter((candidate) => candidate.id !== song.id);
      setQueue([song, ...others]);
      setIndex(0);
      void load(song);
    },
    [load],
  );

  const goTo = useCallback(
    (nextIndex: number) => {
      setQueue((currentQueue) => {
        const target = currentQueue[nextIndex];
        if (!target) return currentQueue;
        setIndex(nextIndex);
        void load(target);
        return currentQueue;
      });
    },
    [load],
  );

  // Entry points overlap, and a duplicate breaks shuffle's "played once" bookkeeping.
  const unqueued = useCallback(
    (additions: Song[]) => {
      const known = new Set(queue.map((song) => song.id));
      return additions.filter((song) => !known.has(song.id));
    },
    [queue],
  );

  /** Positions still unplayed in this shuffle pass, the current song excluded. */
  const unplayed = useCallback(
    () =>
      queue
        .map((song, position) => ({ song, position }))
        .filter(({ song, position }) => position !== index && !shuffled.current.has(song.id)),
    [queue, index],
  );

  // Null at queue end. Repeat and shuffle resolve here, so manual skip and auto-advance
  // can never disagree about what "next" means.
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

  // Mirrors `advance` rather than calling `nextIndex`: drawing a song picks one at random and
  // resets the shuffle pass, which is no business of a disabled check. `repeat === "one"` is
  // deliberately absent — `nextIndex` does not special-case it, so at queue end with nothing
  // to blend a Next button that claimed to work did nothing at all.
  const hasNext = useMemo(() => {
    if (queue.length === 0) return false;
    if (repeat === "all") return true;
    // The pass is a ref, and reading one while rendering is normally stale by design. It is
    // safe here and only here: it changes only alongside `index`, `queue` or `shuffle`, all of
    // which this memo already depends on, so the button cannot be left behind.
    // eslint-disable-next-line react-hooks/refs
    if (shuffle ? unplayed().length > 0 : index + 1 < queue.length) return true;
    return unqueued(radio).length > 0;
  }, [index, queue, radio, repeat, shuffle, unplayed, unqueued]);

  /**
   * One step forward, for a skip and for a track that ended alike: they were two copies of
   * this sequence and drifted. `fromEnd` is the only real difference — a skip that can go
   * nowhere leaves the song playing, while playback that ran out of queue has stopped.
   *
   * `goTo` reads the queue inside a `setQueue` updater, which React runs in order, so it sees
   * songs appended just above.
   */
  const advance = useCallback(
    (fromEnd: boolean) => {
      // A turn is spent whether the song finished or was skipped past, or shuffle draws it
      // again at once.
      const playing = queue[index];
      if (playing) shuffled.current.add(playing.id);

      const target = nextIndex();
      if (target !== null) {
        goTo(target);
        return;
      }

      const fresh = unqueued(radio);
      if (fresh.length === 0) {
        if (fromEnd) setState("idle");
        return;
      }

      setQueue((current) => [...current, ...fresh]);
      setRadio([]);
      // Where the old queue ended, *not* `index + 1`. Those match only when the
      // current song is last — in shuffle a spent pass returns null from any
      // position, so `index + 1` landed on a played song and left the radio unplayed.
      goTo(queue.length);
    },
    [goTo, index, nextIndex, queue, radio, unqueued],
  );

  const next = useCallback(() => advance(false), [advance]);

  const previous = useCallback(() => goTo(Math.max(0, index - 1)), [goTo, index]);

  const toggleShuffle = useCallback(() => {
    const modes = modeStore.getSnapshot();
    // A fresh pass on each switch-on, or half the queue stays unreachable.
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
    songRef.current = null;
    setVideoId(null);
    setSoundcloudUrl(null);
    setActiveSource(null);
    setState("idle");
    setProblem(null);
    setPosition(0);
    setDuration(0);
  }, []);

  const enqueue = useCallback(
    (songs: Song[]) => {
      const fresh = unqueued(songs);
      if (fresh.length === 0) return;

      // Adding to an empty queue must start playback, or nothing loads the song.
      if (queue.length === 0) {
        setQueue(fresh);
        setIndex(0);
        void load(fresh[0]!);
        return;
      }

      setQueue([...queue, ...fresh]);
    },
    [load, queue, unqueued],
  );

  /** Applies an edit from `queue-ops`, which owns the index arithmetic. */
  const applyEdit = useCallback(
    (edit: QueueEdit | null) => {
      if (!edit) return;
      setQueue(edit.queue);
      setIndex(edit.index);
      if (edit.stopped) stop();
      else if (edit.play) void load(edit.play);
    },
    [load, stop],
  );

  const removeAt = useCallback(
    (position: number) => {
      const song = queue[position];
      if (!song) return;
      // Otherwise a re-added song counts as already played and gets skipped.
      shuffled.current.delete(song.id);
      applyEdit(removeFromQueue(queue, index, position));
    },
    [applyEdit, index, queue],
  );

  const move = useCallback(
    (from: number, to: number) => applyEdit(moveWithin(queue, index, from, to)),
    [applyEdit, index, queue],
  );

  const clearQueue = useCallback(() => {
    setQueue((current) => current.slice(0, index + 1));
  }, [index]);

  // Read by the radio effect but not depended on — as deps they refetch on every append.
  const queueRef = useRef<Song[]>(queue);
  const indexRef = useRef(index);

  useEffect(() => {
    queueRef.current = queue;
    indexRef.current = index;
  }, [queue, index]);

  // Seeded from the video id actually loaded, so it stays right after a fall-through.
  useEffect(() => {
    const seed = activeSource === "ytmusic" ? videoId : null;
    const song = queue[index];
    if (!seed || !song) return;

    const params = new URLSearchParams({ id: seed, title: song.title, limit: "25" });
    const artist = song.artists[0];
    if (artist) params.set("artist", artist);

    const aborter = new AbortController();
    fetch(`/api/radio?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<SongsResponse>) : null))
      .then((data) => {
        const songs = data?.songs ?? [];

        // Adopted only when nothing follows, so a one-song queue shows "up next" instead
        // of twenty-six entries the moment it ends. Mid-queue it stays parked, or the
        // moving seed grows the queue without bound.
        const queued = queueRef.current;
        if (indexRef.current < queued.length - 1) {
          setRadio(songs);
          return;
        }

        const known = new Set(queued.map((song) => song.id));
        const fresh = songs.filter((song) => !known.has(song.id));
        setRadio([]);
        if (fresh.length > 0) setQueue((current) => [...current, ...fresh]);
      })
      .catch(() => {
        // No recommendations is not worth surfacing: the queue still plays.
      });

    return () => aborter.abort();
    // Keyed on the loaded upload alone — see the ref note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, videoId]);

  const toggle = useCallback(() => toggleRef.current?.(), []);
  const seek = useCallback((seconds: number) => seekRef.current?.(seconds), []);

  const setVolume = useCallback((level: number) => writeVolume(level), []);
  const toggleMute = useCallback(() => writeMuteToggle(), []);
  // Closing the panel leaves theater — a hidden-but-expanded panel blanks the content area.
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

  const handleProgress = useCallback((next: number, total: number) => {
    setPosition(next);
    setDuration(total);
  }, []);

  // On "playing": `load` counts copies that refused and `handleEnded` misses skips.
  const handleStateChange = useCallback(
    (next: PlayState) => {
      setState(next);
      if (next !== "playing") return;

      const song = queue[index];
      if (!song || recorded.current === song.id) return;
      recorded.current = song.id;

      recordPlay({
        id: song.id,
        title: song.title,
        artists: song.artists,
        artworkUrl: song.artworkUrl,
        // The upload that played, not the one the song shipped with — only it can seed a radio.
        videoId,
      });
    },
    [queue, index, videoId],
  );

  const handleError = useCallback(
    async (reason: string, worthRetrying: boolean) => {
      const song = songRef.current;
      if (!worthRetrying || !song) {
        setState("unplayable");
        setProblem(reason);
        return;
      }

      setState("resolving");
      try {
        if (candidates.current.length === 0) {
          // Cancel the previous, or a fall-through mid-`load` leaves it running and its
          // response overwrites `candidates` for a song no longer playing.
          resolving.current?.abort();
          const aborter = new AbortController();
          resolving.current = aborter;
          candidates.current = await findCandidates(song, aborter.signal);
        }
        const alternative = candidates.current.find((id) => !attempted.current.has(id));
        if (alternative) {
          attempt(alternative);
          return;
        }
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
      }

      // SoundCloud has its own rights position, and reports not-worth-retrying, so a failure
      // exits above rather than looping back here.
      const soundcloud = soundcloudUrlOf(song);
      if (soundcloud) {
        attemptSoundCloud(soundcloud);
        return;
      }

      setState("unplayable");
      setProblem("Every copy of this song blocks playback outside YouTube.");
    },
    [attempt, attemptSoundCloud, findCandidates],
  );

  const handleEnded = useCallback(() => {
    // Repeat-one ignores the queue entirely; everything else is `advance`, which also
    // continues into the recommendations at queue end.
    if (repeat === "one") {
      goTo(index);
      return;
    }
    advance(true);
  }, [advance, goTo, index, repeat]);

  const registerToggle = useCallback((fn: (() => void) | null) => {
    toggleRef.current = fn;
  }, []);

  const registerSeek = useCallback((fn: ((seconds: number) => void) | null) => {
    seekRef.current = fn;
  }, []);

  const value = useMemo<PlayerControls>(
    () => ({
      queue,
      index,
      current,
      videoId,
      soundcloudUrl,
      activeSource,
      panelOpen,
      theater,
      state,
      problem,
      position,
      duration,
      volume,
      muted,
      radio,
      shuffle,
      repeat,
      hasNext,
      play,
      enqueue,
      removeAt,
      move,
      clearQueue,
      toggle,
      next,
      previous,
      handleEnded,
      handleStateChange,
      handleProgress,
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
    }),
    [
      queue,
      index,
      current,
      videoId,
      soundcloudUrl,
      activeSource,
      panelOpen,
      theater,
      state,
      problem,
      position,
      duration,
      volume,
      muted,
      radio,
      shuffle,
      repeat,
      hasNext,
      play,
      enqueue,
      removeAt,
      move,
      clearQueue,
      toggle,
      next,
      previous,
      handleEnded,
      handleStateChange,
      handleProgress,
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
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
