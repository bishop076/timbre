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
 */

export type PlayState = "idle" | "resolving" | "loading" | "playing" | "paused" | "unplayable";

interface PlayerState {
  queue: Song[];
  index: number;
  current: Song | null;
  /** YouTube video id currently loaded, or null. */
  videoId: string | null;
  state: PlayState;
  /** Why the current song could not be played, when state is "unplayable". */
  problem: string | null;
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
  registerToggle: (fn: (() => void) | null) => void;
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

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [state, setState] = useState<PlayState>("idle");
  const [problem, setProblem] = useState<string | null>(null);

  // Set by the embedded player so the bar's play/pause button can reach it.
  const toggleRef = useRef<(() => void) | null>(null);
  const resolving = useRef<AbortController | null>(null);

  const current = queue[index] ?? null;

  /**
   * Finds a playable copy. Songs that came from a chart usually have no
   * YouTube Music source attached, so Timbre searches for one — which is
   * exactly the cross-source promise, just applied at play time.
   */
  const load = useCallback(async (song: Song) => {
    const direct = youtubeIdOf(song);
    if (direct) {
      setVideoId(direct);
      setProblem(null);
      setState("loading");
      return;
    }

    resolving.current?.abort();
    const aborter = new AbortController();
    resolving.current = aborter;

    setState("resolving");
    setProblem(null);

    const query = [song.title, song.artists[0]].filter(Boolean).join(" ");
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=5`, {
        signal: aborter.signal,
      });
      if (!response.ok) throw new Error("search failed");
      const data = (await response.json()) as SongsResponse;

      const match = data.songs.map(youtubeIdOf).find((id): id is string => id !== null);
      if (!match) {
        setVideoId(null);
        setState("unplayable");
        setProblem("No playable copy found on YouTube Music.");
        return;
      }

      setVideoId(match);
      setState("loading");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setVideoId(null);
      setState("unplayable");
      setProblem("Couldn't find a playable copy.");
    }
  }, []);

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

  const handleEnded = useCallback(() => {
    if (index + 1 < queue.length) goTo(index + 1);
    else setState("idle");
  }, [goTo, index, queue.length]);

  const registerToggle = useCallback((fn: (() => void) | null) => {
    toggleRef.current = fn;
  }, []);

  const value = useMemo<PlayerControls>(
    () => ({
      queue,
      index,
      current,
      videoId,
      state,
      problem,
      play,
      toggle,
      next,
      previous,
      handleEnded,
      handleStateChange: setState,
      registerToggle,
    }),
    [
      queue,
      index,
      current,
      videoId,
      state,
      problem,
      play,
      toggle,
      next,
      previous,
      handleEnded,
      registerToggle,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
