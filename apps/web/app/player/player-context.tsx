"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Song, SongsResponse } from "../types";

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
  state: PlayState;
  /** Why the current song could not be played, when state is "unplayable". */
  problem: string | null;
  /** Playback position and length in seconds, reported by the embedded player. */
  position: number;
  duration: number;
}

interface PlayerControls extends PlayerState {
  /** Plays a song, optionally queueing the list it came from behind it. */
  play: (song: Song, rest?: Song[]) => void;
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
  const [state, setState] = useState<PlayState>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

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
    [attempt, findCandidates],
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

  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const previous = useCallback(() => goTo(Math.max(0, index - 1)), [goTo, index]);

  const toggle = useCallback(() => toggleRef.current?.(), []);
  const seek = useCallback((seconds: number) => seekRef.current?.(seconds), []);

  const handleProgress = useCallback((next: number, total: number) => {
    setPosition(next);
    setDuration(total);
  }, []);

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

  const handleEnded = useCallback(() => {
    if (index + 1 < queue.length) goTo(index + 1);
    else setState("idle");
  }, [goTo, index, queue.length]);

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
      state,
      problem,
      position,
      duration,
      play,
      toggle,
      next,
      previous,
      handleEnded,
      handleStateChange: setState,
      handleProgress,
      handleError,
      seek,
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
      state,
      problem,
      position,
      duration,
      play,
      toggle,
      next,
      previous,
      handleEnded,
      handleProgress,
      handleError,
      seek,
      registerToggle,
      registerSeek,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
