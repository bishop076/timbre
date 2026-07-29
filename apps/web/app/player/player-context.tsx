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

import type { Song, SongsResponse } from "../types";
import { recordPlay } from "./history-store";
import {
  getVolumeServerSnapshot,
  getVolumeSnapshot,
  subscribeVolume,
  writeMuteToggle,
  writeVolume,
} from "./volume-store";

/**
 * The queue holds **songs**, not source-tracks.
 *
 * A song may exist on several services; the controller plays it from whichever
 * source it can actually drive. Only YouTube Music is controllable today —
 * Deezer and Apple are link-only, and Spotify's embed exposes no play API — so
 * a chart entry from Deezer is resolved to its YouTube Music copy before it can
 * play. That resolution is the whole point of the matcher.
 *
 * **One copy is never enough.** Rights holders routinely bar embedding on
 * individual uploads — most often the auto-generated "art tracks" on Topic
 * channels that YouTube Music returns for a plain song search. The embedded
 * player reports only "Video unavailable", and crucially this cannot be
 * detected from the server: a blocked upload still answers oEmbed with 200 and
 * still reports playableInEmbed:true on its watch page. Only the browser
 * learns the truth, and only by trying.
 *
 * So a song carries a list of candidate uploads and falls through to the next
 * when one refuses, instead of declaring the song unplayable on first refusal.
 */

export type PlayState = "idle" | "resolving" | "loading" | "playing" | "paused" | "unplayable";

/**
 * `off` continues into the recommendations when the queue ends, which is the
 * default because a queue that simply stops is the thing this app most wanted
 * to fix. `all` loops the queue instead, and `one` repeats a single track.
 */
export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: Song[];
  index: number;
  current: Song | null;
  /** YouTube video id currently loaded, or null. */
  videoId: string | null;
  /** SoundCloud permalink currently loaded, or null. */
  soundcloudUrl: string | null;
  /**
   * Which player owns the current song.
   *
   * **Exactly one player is ever mounted**, and this is what selects it.
   * Mounting only the active player is deliberate: an unmounted player cannot
   * make sound, whereas a merely-paused one can be restarted by a stray event
   * or a race during handoff. Silence by construction beats silence by
   * discipline — this is the bug most likely to bite.
   */
  activeSource: "ytmusic" | "soundcloud" | null;
  /**
   * Whether the now-playing panel is shown — the third column on desktop, a
   * floating card above the mini player on a phone. The video lives inside it.
   *
   * The video itself carries **no controls of its own** — it is a display, and
   * everything that acts on it lives in the player bar. That is how Spotify
   * treats a track that happens to have a video: one set of controls, always in
   * the same place, whether or not there are pictures.
   *
   * Hiding it never unmounts or resizes the player, only clips it. YouTube's
   * IFrame API stops playback below 200×200, so shrinking to hide would be
   * indistinguishable from breaking it — see docs/BUGS.md B-1.
   */
  panelOpen: boolean;
  /**
   * Whether the panel has taken over the content area as a big video.
   *
   * Clicking the picture expands it; clicking again puts it back. Both states
   * render **the same element**, only sized differently, because moving the
   * player to a different place in the tree would re-parent its iframe — and a
   * re-parented iframe reloads, which means playback stops dead.
   */
  theater: boolean;
  state: PlayState;
  /** Why the current song could not be played, when state is "unplayable". */
  problem: string | null;
  /** Playback position and length in seconds, reported by the embedded player. */
  position: number;
  duration: number;
  /**
   * Output level, 0–100, and whether it is muted.
   *
   * Held here rather than in the player because the player is torn down and
   * rebuilt on every source switch — a level living inside it would reset to
   * full every time a track fell through to another copy. Each player reads
   * this and applies it on ready.
   */
  volume: number;
  muted: boolean;
  /**
   * What to play after the queue, drawn from every source that will answer and
   * ranked by agreement between them — not a passthrough of any one service's
   * radio. See `recommend.ts`.
   *
   * Fetched on **every track change**, not when the queue nears its end. That
   * is the remedy docs/BUGS.md B-5 prescribes for the fall-through stall,
   * applied here: by the time the last song finishes this is already in memory,
   * so continuing costs no network round trip. It also means one fetch serves
   * both the autoplay and the "similar songs" panel.
   */
  radio: Song[];
  shuffle: boolean;
  repeat: RepeatMode;
}

interface PlayerControls extends PlayerState {
  /** Plays a song, optionally queueing the list it came from behind it. */
  play: (song: Song, rest?: Song[]) => void;
  /** Appends to the queue without disturbing what is playing. */
  enqueue: (songs: Song[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  /** Called by the embedded player when a track finishes. */
  handleEnded: () => void;
  handleStateChange: (state: PlayState) => void;
  handleProgress: (position: number, duration: number) => void;
  /**
   * Reports a playback failure. `worthRetrying` is true when the fault belongs
   * to this upload — embedding disabled, video removed — so another copy of
   * the same song stands a chance.
   */
  handleError: (reason: string, worthRetrying: boolean) => void;
  seek: (seconds: number) => void;
  /** Sets the level, 0–100. Setting it unmutes, since that is what was meant. */
  setVolume: (level: number) => void;
  toggleMute: () => void;
  /** Shows or hides the now-playing panel. Never resizes the player inside it. */
  togglePanel: () => void;
  /** Expands the video to fill the content area, or puts it back in the panel. */
  toggleTheater: () => void;
  /**
   * Puts the video back without toggling. Navigation needs this: the expanded
   * video *replaces* the content area, so going to Search or Library while it
   * is open would change a page nobody can see.
   */
  exitTheater: () => void;
  toggleShuffle: () => void;
  /** Steps off → all → one → off. One button, three states, like every player. */
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

/** The YouTube Music copy of a song, if it has one. */
function youtubeIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
}

/**
 * The SoundCloud copy, if it has one. The widget takes a permalink rather than
 * an id, which is why this returns `url` and not `sourceId`.
 */
function soundcloudUrlOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "soundcloud")?.url ?? null;
}

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
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  /**
   * Songs already played in this shuffle pass, by id.
   *
   * Without it, "random next" replays tracks while others go unheard — the
   * complaint everyone has about naive shuffle. A pass ends when every song has
   * been played, and only then does it start over.
   */
  const shuffled = useRef<Set<string>>(new Set());
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const { volume, muted } = useSyncExternalStore(
    subscribeVolume,
    getVolumeSnapshot,
    getVolumeServerSnapshot,
  );

  // Set by the embedded player so the bar's play/pause button can reach it.
  const toggleRef = useRef<(() => void) | null>(null);
  const seekRef = useRef<((seconds: number) => void) | null>(null);
  const resolving = useRef<AbortController | null>(null);

  // Fallback bookkeeping for the song currently being attempted.
  const songRef = useRef<Song | null>(null);
  const candidates = useRef<string[]>([]);
  const attempted = useRef<Set<string>>(new Set());

  const current = queue[index] ?? null;

  const attempt = useCallback((id: string) => {
    attempted.current.add(id);
    // Switching players tears the other one down, which is what guarantees
    // only one is audible.
    setSoundcloudUrl(null);
    setActiveSource("ytmusic");
    setVideoId(id);
    setProblem(null);
    setState("loading");
  }, []);

  /** Hands the song to the SoundCloud widget instead of the YouTube player. */
  const attemptSoundCloud = useCallback((url: string) => {
    setVideoId(null);
    setActiveSource("soundcloud");
    setSoundcloudUrl(url);
    setProblem(null);
    setState("loading");
  }, []);

  /** Every YouTube Music upload of this song the search knows about. */
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
      setPosition(0);
      setDuration(0);
      setActiveSource(null);
      setVideoId(null);
      setSoundcloudUrl(null);

      // A song found on YouTube Music already has a copy to try; alternatives
      // are fetched only if it turns out to be blocked, so the common case
      // costs no extra request.
      const direct = youtubeIdOf(song);
      if (direct) {
        attempt(direct);
        return;
      }

      // No YouTube copy, but SoundCloud can play it. This is the only path for
      // a pasted SoundCloud link, since that catalogue cannot be searched.
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

  /**
   * Which song follows this one, or null when the queue is spent.
   *
   * Null is meaningful rather than an error: it is what hands over to the
   * recommendations. Repeat and shuffle both resolve here so that the manual
   * skip button and auto-advance can never disagree about what "next" means.
   */
  const nextIndex = useCallback((): number | null => {
    if (queue.length === 0) return null;

    if (shuffle) {
      const unplayed = queue
        .map((song, position) => ({ song, position }))
        .filter(({ song, position }) => position !== index && !shuffled.current.has(song.id));

      if (unplayed.length > 0) {
        return unplayed[Math.floor(Math.random() * unplayed.length)]!.position;
      }
      // Every song has had a turn. Only a repeating queue starts a new pass;
      // otherwise this is genuinely the end and the radio takes over.
      if (repeat === "all") {
        shuffled.current = new Set();
        return queue.length > 1 ? (index + 1) % queue.length : index;
      }
      return null;
    }

    if (index + 1 < queue.length) return index + 1;
    return repeat === "all" ? 0 : null;
  }, [queue, index, shuffle, repeat]);

  const next = useCallback(() => {
    const target = nextIndex();
    // A manual skip at the end of a non-repeating queue steps into the
    // recommendations rather than doing nothing.
    if (target === null) {
      const known = new Set(queue.map((song) => song.id));
      const fresh = radio.filter((song) => !known.has(song.id));
      if (fresh.length === 0) return;
      setQueue((current) => [...current, ...fresh]);
      setRadio([]);
      goTo(index + 1);
      return;
    }
    goTo(target);
  }, [goTo, index, nextIndex, queue, radio]);

  const previous = useCallback(() => goTo(Math.max(0, index - 1)), [goTo, index]);

  const toggleShuffle = useCallback(() => {
    setShuffle((on) => {
      // A fresh pass each time it is switched on, so turning it off and back on
      // does not leave half the queue unreachable.
      shuffled.current = new Set();
      return !on;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, []);

  const enqueue = useCallback((songs: Song[]) => {
    setQueue((current) => {
      const known = new Set(current.map((song) => song.id));
      return [...current, ...songs.filter((song) => !known.has(song.id))];
    });
  }, []);

  /*
   * Recommendations for whatever is playing.
   *
   * Seeded from the video id **actually loaded** rather than from the song's
   * declared source, so it stays correct after a fall-through picked a
   * different upload, and works for a chart song whose YouTube copy was found
   * by search rather than shipped with it.
   */
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
      .then((data) => setRadio(data?.songs ?? []))
      .catch(() => {
        // No recommendations is not an error worth showing anyone: the queue
        // still plays and the panel simply hides its shelf.
      });

    return () => aborter.abort();
    // Deliberately keyed on the loaded upload alone. Depending on the song
    // object would refetch whenever the queue array is rebuilt, and depending
    // on `queue`/`index` would refetch on every append.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, videoId]);

  const toggle = useCallback(() => toggleRef.current?.(), []);
  const seek = useCallback((seconds: number) => seekRef.current?.(seconds), []);

  const setVolume = useCallback((level: number) => writeVolume(level), []);
  const toggleMute = useCallback(() => writeMuteToggle(), []);
  // Closing the panel leaves theater too: the expanded video *is* the panel, so
  // a hidden panel that is still "expanded" would blank the content area for a
  // video nobody can see.
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

  /**
   * Records a play the first time a song actually starts.
   *
   * On "playing" rather than on `load`, which would record songs that never
   * played because every copy refused to embed — and rather than on
   * `handleEnded`, which would miss the songs you skipped but nonetheless
   * chose. The ref stops a pause/resume from recording the same song twice.
   */
  const recorded = useRef<string | null>(null);
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
        // The upload that played, not the one the song shipped with — that is
        // what can seed a radio later.
        videoId,
        playedAt: Date.now(),
      });
    },
    [queue, index, videoId],
  );

  /**
   * A copy refused to play. Blocked embedding belongs to one upload, not to
   * the song, so try the next upload before giving up on it.
   */
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

      // Every YouTube upload refused. If SoundCloud has this song, it is a
      // genuinely different service with its own rights position, so it is
      // worth one last try before declaring defeat.
      //
      // The SoundCloud player always reports errors as not-worth-retrying, so
      // a failure here exits above rather than looping back into this branch.
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

  /**
   * A song finished.
   *
   * When the queue runs out, it continues into the recommendations rather than
   * stopping — which is what every music app does, and what the dead `idle`
   * branch here used to prevent. The list is already in memory (see the fetch
   * effect), so this costs no round trip and the gap is just the player load.
   *
   * `goTo` reads the queue inside a `setQueue` updater, and React runs queued
   * updaters in order, so it observes the appended songs rather than the stale
   * array this closure captured.
   */
  const handleEnded = useCallback(() => {
    // Repeat-one is checked before anything else: it is the one mode that means
    // "ignore the queue entirely".
    if (repeat === "one") {
      goTo(index);
      return;
    }

    const current = queue[index];
    if (current) shuffled.current.add(current.id);

    const target = nextIndex();
    if (target !== null) {
      goTo(target);
      return;
    }

    const known = new Set(queue.map((song) => song.id));
    const fresh = radio.filter((song) => !known.has(song.id));
    if (fresh.length === 0) {
      setState("idle");
      return;
    }

    setQueue((current) => [...current, ...fresh]);
    // Consumed. The next track changes the seed, which refills this — so the
    // radio is effectively endless, with the id filter as the only loop guard.
    setRadio([]);
    goTo(index + 1);
  }, [goTo, index, nextIndex, queue, radio, repeat]);

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
      play,
      enqueue,
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
      play,
      enqueue,
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
