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

import { SkipLink } from "../a11y/skip-link";
import { createLocalStore, createNotifier, useLocalStore } from "../local-store.ts";
import { log } from "../logs.ts";
import { addSourcesToSong } from "../playlists/store";
import { getSpotifyTokens, useSpotifyTokens } from "../spotify/token-store.ts";
import type { Song, SongsResponse } from "../types";
import { judgeDeadTrack } from "./dead-track";
import { drawRadio } from "./draw-radio";
import { getHistorySnapshot, recordPlay } from "./history-store";
import { PlaybackAnnouncer } from "./playback-announcer";
import { playedHandle } from "./played-handle";
import { getPlaybackPrefs, usePlaybackPrefs } from "./playback-prefs";
import { insertAfter, moveWithin, removeAt as removeFromQueue, type QueueEdit } from "./queue-ops";
import type { QueueOrigin } from "./queue-origin.ts";
import { takeTrackEndStop } from "./sleep-timer.ts";
import { clearSpotifyLeading, markSpotifyLeading, spotifyShouldLead } from "./spotify-lead";
import { plausiblySameSong, rankMatches, sameTrack } from "./song-match";
import { forgetFailedSource, pickSource, rememberedSource } from "./source-choice";
import { isProgressive, streamUrlFor, type ProgressiveSource } from "./stream-url";
import { describeVerdict, judgePause, RESUME_DELAY_MS } from "./unasked-pause";
import { useTabSync } from "./use-tab-sync";
import { volumeOutOfReach } from "./volume-reach.ts";
import { useVolume, writeMuteToggle, writeVolume } from "./volume-store";
import { whyLeftYouTube, type LeftYouTube, type YouTubeFailures } from "./youtube-refusal";

const RADIO_POOL = 50;
const RADIO_PICKS = 25;
const RADIO_RETRIES = 2;
const RADIO_RETRY_MS = 2500;

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
let progressAt = 0;

function writeProgress(position: number, duration: number): void {
  // Stamped before the early return, and so counting every report rather than every *change*.
  // `judgePause` needs to know when the source last spoke: a stalled source still reporting the
  // same second is current news, while a background tab's clamped poll is a minute out of date,
  // and the difference between those two is the difference between rescuing playback and
  // fighting it.
  progressAt = Date.now();
  if (position === progressSnapshot.position && duration === progressSnapshot.duration) return;
  progressSnapshot = { position, duration };
  ticks.emit();
}

// The state behind the unasked-pause rescue below. Module-scoped for the same reason
// `progressSnapshot` is — there is one player to a tab — and because it has to be: the compiler
// will not let a ref be written from inside one hook and read from another, and seeding a ref
// with `Date.now()` is calling an impure function during render. `lastInteraction` is seeded in
// the effect that maintains it, which is both pure and the right moment.
let lastInteraction = 0;
let sourceStartedAt = 0;
let unaskedResumes = 0;
let resumeTimer: ReturnType<typeof setTimeout> | undefined;

/** Drop a rescue that is no longer wanted, and hand the next track a fresh allowance. */
function cancelResume(): void {
  unaskedResumes = 0;
  clearTimeout(resumeTimer);
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
  return rankMatches(song, data.songs.filter((found) => plausiblySameSong(song, found)));
}

// Names no cause, as B-33's three codes do. An extension, a network filter and this site's own
// Content-Security-Policy all present identically here, and the app cannot tell them apart —
// `POST /api/csp-report` is what distinguishes the third.
const GAVE_UP_ON_YOUTUBE: Record<LeftYouTube, string> = {
  blocked: "YouTube's player never loaded here, and nothing else could play it.",
  refused: "YouTube refused this connection (a VPN, maybe), and nothing else could play it.",
};

export function giveUpReason(
  youtubeCopies: number,
  triedProgressive: boolean,
  left: LeftYouTube | null = null,
): string {
  if (left) return GAVE_UP_ON_YOUTUBE[left];
  if (youtubeCopies > 0 && triedProgressive) {
    return `Nothing here would play — ${youtubeCopies} YouTube ${youtubeCopies === 1 ? "copy" : "copies"} refused, and the other sources failed too.`;
  }
  if (youtubeCopies > 0) {
    return youtubeCopies === 1
      ? "The only copy on YouTube wouldn't play here, and nothing else could either."
      : `None of the ${youtubeCopies} copies on YouTube would play here, and nothing else could either.`;
  }
  // Not "there's no copy on YouTube". This line is reached with `attempted` empty, which is not
  // an absence anybody checked — a search that failed outright leaves exactly this state, and
  // asserting a cause the app never verified is B-6's mistake in a different sentence.
  if (triedProgressive) return "This track wouldn't stream, and nothing else here would play it.";
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

/**
 * The exact thing that was tried, as opposed to the rung that was used.
 *
 * `spentKey` answers "has the SoundCloud rung had its turn", which is the right question for the
 * ladder and the wrong one for the rescue below it. The rescue's whole job is to find *another*
 * copy, and the search it draws from routinely returns this very track first — so `adoptElsewhere`
 * handed `start` the identical url that had just failed. Nothing about the player's props changed,
 * so no effect re-ran, no deadline was armed and nothing raised an error; and `rescued` closed the
 * ladder behind it. The track sat on "SoundCloud 0:00" for ever with the play button showing Play.
 *
 * Kept in the same set as `spentKey`, because both are answers to "what has this attempt done" and
 * a second set would be one more thing for `load` to remember to clear.
 */
export function attemptKey(chosen: ChosenSource): string {
  switch (chosen.kind) {
    case "soundcloud":
      return `soundcloud:${chosen.url}`;
    case "progressive":
      return `progressive:${chosen.source}:${chosen.sourceId}`;
    case "preview":
      return `preview:${chosen.source}:${chosen.url}`;
    case "subscription":
      return `subscription:${chosen.source}:${chosen.id}`;
    default:
      return `${chosen.kind}:${chosen.id}`;
  }
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
  return (
    <PlayerContext.Provider value={value}>
      {/* Two app-wide accessibility fixtures, mounted here because this provider is the
          outermost thing in <body> that is not `layout.tsx` or `app-shell.tsx`. The skip link
          has to be the first focusable element on the page, which it is from here; the
          announcer has to be inside this provider to see the player at all. If the shell is
          ever reorganised, `<SkipLink />` belongs directly inside <body> in layout.tsx. */}
      <SkipLink />
      <PlaybackAnnouncer />
      {children}
    </PlayerContext.Provider>
  );
}

function usePlayerValue() {
  const [queue, setQueue] = useState<Song[]>([]);
  // Which list this queue was started from. A song carries `from` for its artist, but nothing
  // recorded the list itself, so no page could say "this is the one playing".
  const [queueOrigin, setQueueOrigin] = useState<QueueOrigin | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState<ChosenSource | null>(null);
  const [youtubeTurnedAway, setYoutubeTurnedAway] = useState<LeftYouTube | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [theater, setTheater] = useState(false);
  const [state, setState] = useState<PlayState>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [radio, setRadio] = useState<Song[]>([]);
  const { shuffle, repeat } = useLocalStore(modeStore);
  const { continueWithRadio } = usePlaybackPrefs();
  const { volume, muted } = useVolume();
  const spotifyTokens = useSpotifyTokens();

  const queueRef = useRef<Song[]>([]);
  const stateRef = useRef<PlayState>("idle");
  const indexRef = useRef(index);

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
  const youtubeFailures = useRef<YouTubeFailures>({
    blocked: false,
    stalled: false,
    refusals: 0,
  });
  const rescued = useRef<Set<string>>(new Set());
  const recorded = useRef<string | null>(null);
  const steered = useRef<string | null>(null);
  // The two facts behind the dead-track skip below. `handPicked` is whether a listener named
  // this source themselves; `deadSkips` counts the run of tracks stepped over since one last
  // played, which is what bounds the skipping on a queue where nothing works.
  const handPicked = useRef(false);
  const deadSkips = useRef(0);
  const warmed = useRef(new Map<string, { matches: Promise<Song[]>; aborter: AbortController }>());

  const current = queue[index] ?? null;
  const activeSource = playing && ("source" in playing ? playing.source : playing.kind);
  const videoId = playing?.kind === "ytmusic" ? playing.id : null;
  const soundcloudUrl = playing?.kind === "soundcloud" ? playing.url : null;
  const mixcloudKey = playing?.kind === "mixcloud" ? playing.id : null;
  const spotifyTrackId = playing?.kind === "spotify" ? playing.id : null;
  const subscriptionTrack = playing?.kind === "subscription" ? playing : null;
  const playingPreview = playing?.kind === "preview";
  // Why the volume control cannot reach this source, if it cannot. Null for the five players
  // that take a level, which is every source but Spotify's embed and the two subscription ones.
  const volumeUnreachable = volumeOutOfReach(playing?.kind ?? null, spotifyTokens !== null);
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

  // The position the queue is *at*, as opposed to the one the last render drew. `indexRef` used
  // to be caught up in an effect, which is a paint too late for anything driven by a press: two
  // clicks on Next inside one frame both read the render's `index`, both computed the same
  // target, and the second landed on the song the first had just started — `openSong` saw the
  // same id and restarted it instead of skipping. Four presses moved two songs; three presses of
  // Previous moved one. The queue-editing helpers below already read this ref believing it
  // current, so they were wrong in the same window. Kept in step the way `queueRef` is.
  const writeIndex = useCallback((position: number) => {
    indexRef.current = position;
    setIndex(position);
  }, []);

  // What the player is doing, as opposed to what the last render drew — the same distinction
  // `writeIndex` draws, and for the same reason. Three places read this ref to decide whether to
  // touch the transport, and the riskiest is the unasked-pause rescue, which fires a *toggle*:
  // catching the ref up in an effect left a window in which a source that had already started
  // playing again still read as paused, and the rescue meant to put playback back on took it
  // off instead. Written where the report arrives, so there is no window.
  const writeState = useCallback((next: PlayState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const dropRadio = useCallback(() => {
    radioRequest.current?.abort();
    seededFor.current = null;
  }, []);

  useEffect(() => dropRadio, [dropRadio]);

  const start = useCallback((chosen: ChosenSource) => {
    if (chosen.kind === "ytmusic") attempted.current.add(chosen.id);
    else spent.current.add(spentKey(chosen)).add(attemptKey(chosen));
    // Every route to a playing source comes through here, which makes it the one place that
    // knows when the thing about to report pauses was handed its track. `judgePause` needs that
    // to tell a source starting up from a source giving up.
    sourceStartedAt = Date.now();
    setPlaying(chosen);
    setProblem(problemFor(chosen));
    writeState(chosen.kind === "subscription" ? "paused" : "loading");
  }, [writeState]);

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

      // Each option is tested against what this attempt has already tried, which is not the
      // question the rungs above ask: those ask whether a *kind* has had its turn, and every
      // rescue is a second helping of one. A copy offering nothing but the url that just failed
      // is not a rescue, and taking it ends the ladder — see `attemptKey`.
      const playable = (match: Song) =>
        [
          progressiveOf(match),
          mixcloud ? chosenSource(match, "mixcloud") : null,
          chosenSource(match, "soundcloud"),
          chosenSource(match, "spotify"),
        ].find((found) => found !== null && !spent.current.has(attemptKey(found))) ?? null;
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
      // Scoped to this walk, like everything above it. `adoptElsewhere` is guarded so that a
      // rescue whose own source then fails cannot rescue again and loop — that guard belongs to
      // the attempt, not to the song for the life of the tab. Left standing it outlived its
      // purpose: `id` is the ISRC where there is one, so meeting the song again in a later
      // search brought back the original broken sources and the rescue that fixed them once
      // silently declined to run.
      rescued.current = new Set();
      youtubeFailures.current = { blocked: false, stalled: false, refusals: 0 };
      recorded.current = null;
      steered.current = null;
      // Scoped to the track, like the rest of this: a new song gets its own allowance of
      // resumes, and any resume still pending for the old one is no longer wanted.
      cancelResume();
      clearSpotifyLeading();
      setYoutubeTurnedAway(null);
      setPlaying(null);
      writeProgress(0, song.durationMs ? song.durationMs / 1000 : 0);
      // Read from the argument rather than from `prefer` below, which `rememberedSource` fills
      // in a line later: a source this song happens to have been played on before is not one
      // anybody just pressed, and if it fails the ladder carries on past it anyway.
      handPicked.current = prefer !== undefined;

      prefer ??= rememberedSource(song);
      const named = prefer && prefer !== "ytmusic" ? chosenSource(song, prefer) : null;
      if (prefer && named) {
        steered.current = prefer;
        return start(named);
      }

      // Spotify first, when Spotify can actually carry a queue. Connected, the Web Playback SDK
      // plays the whole track and reports its own end, so the next song follows; signed out, this
      // source is a 30-second clip behind a press — `playbackFrom` calls it "manual" — and leading
      // with it would stall the queue on every track that has one. So the order turns on the
      // tokens rather than on the source list, and YouTube stays the opening move without them.
      const spotifyFirst = spotifyShouldLead(getSpotifyTokens() !== null)
        ? chosenSource(song, "spotify")
        : null;
      if (spotifyFirst) {
        markSpotifyLeading();
        return start(spotifyFirst);
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
      writeState("resolving");
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
        writeState("unplayable");
        setProblem("No copy of this song exists on YouTube Music.");
      } catch (cause) {
        if (isAbort(cause)) return;
        setPlaying(null);
        writeState("unplayable");
        setProblem("Couldn't find a playable copy.");
      }
    },
    [adoptElsewhere, dropRadio, matchesFor, start, writeState],
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
    (song: Song, rest: Song[] = [], prefer?: string, origin?: QueueOrigin) => {
      // Starting something fresh hands the dead-track skip below a full allowance again. It is
      // spent by tracks that would not play, and only playing one — or asking for another list
      // — earns it back; `goTo` does not, because `advance` reaches the queue through it.
      deadSkips.current = 0;
      if (prefer) pickSource(song, prefer, playbackFrom(song, prefer));
      const switchingSource = prefer && rest.length === 0 && songRef.current?.id === song.id;
      if (!switchingSource) {
        writeQueue([song, ...rest.filter((candidate) => candidate.id !== song.id)]);
        writeIndex(0);
        // Only a fresh queue changes where playback came from; swapping a song's source does not.
        setQueueOrigin(origin ?? null);
      }
      openSong(song, prefer);
    },
    [openSong, writeIndex, writeQueue],
  );

  const goTo = useCallback(
    (position: number) => {
      const target = queueRef.current[position];
      if (!target) return;
      writeIndex(position);
      openSong(target);
    },
    [openSong, writeIndex],
  );

  const unqueued = useCallback(
    (additions: Song[]) =>
      additions.filter((song) => !queue.some((queued) => sameTrack(queued, song))),
    [queue],
  );

  // Both of these take the position to reckon from rather than closing over `index`: what the
  // last render drew is the right answer for `hasNext`, and the wrong one for a press, which
  // has to reckon from wherever the queue already is.
  const unplayed = useCallback(
    (from: number) =>
      queue.flatMap((song, position) =>
        position === from || shuffled.current.has(song.id) ? [] : [position],
      ),
    [queue],
  );

  const nextIndex = useCallback(
    (from: number): number | null => {
      if (queue.length === 0) return null;
      if (shuffle) {
        const pool = unplayed(from);
        if (pool.length > 0) return pool[Math.floor(Math.random() * pool.length)];
        if (repeat !== "all") return null;
        shuffled.current = new Set();
        return queue.length > 1 ? (from + 1) % queue.length : from;
      }
      if (from + 1 < queue.length) return from + 1;
      return repeat === "all" ? 0 : null;
    },
    [queue, shuffle, repeat, unplayed],
  );

  const hasNext = useMemo(() => {
    if (queue.length === 0) return false;
    if (repeat === "all") return true;
    // eslint-disable-next-line react-hooks/refs
    if (shuffle ? unplayed(index).length > 0 : index + 1 < queue.length) return true;
    return continueWithRadio && unqueued(radio).length > 0;
  }, [continueWithRadio, index, queue, radio, repeat, shuffle, unplayed, unqueued]);

  /** Moves the queue on, and answers whether there was anywhere to move it to. */
  const advance = useCallback(
    (fromEnd: boolean): boolean => {
      const here = indexRef.current;
      const playing = queueRef.current[here];
      if (playing) shuffled.current.add(playing.id);

      const target = nextIndex(here);
      if (target !== null) {
        if (target === here && fromEnd) restart(true);
        else goTo(target);
        return true;
      }

      const fresh = continueWithRadio ? unqueued(radio) : [];
      if (fresh.length === 0) {
        if (fromEnd) writeState("idle");
        return false;
      }
      // Where the appended block starts, read before the append rather than from the render's
      // own `queue` — which the async radio fetch may already have grown past.
      const landing = queueRef.current.length;
      writeQueue((queued) => [...queued, ...fresh]);
      setRadio([]);
      goTo(landing);
      return true;
    },
    [continueWithRadio, goTo, nextIndex, radio, restart, unqueued, writeQueue, writeState],
  );

  const next = useCallback((): void => void advance(false), [advance]);
  const previous = useCallback(() => goTo(Math.max(0, indexRef.current - 1)), [goTo]);

  const handleEnded = useCallback(() => {
    // Every source reports the last second of a track as a pause and then as an end, a couple
    // of hundred milliseconds apart, so `handleStateChange` has already judged that pause —
    // and it judges it from `progressSnapshot`, which for every embedded source is refreshed
    // by a `setInterval` a background tab clamps to once a minute. Away from the tab the
    // reading is minutes stale, "the track is ending" does not hold, and a natural end is read
    // as the source stopping by itself: a rescue is armed against the song that just finished.
    // `load` used to be the only thing that took it back, which made this a race it happened to
    // win. A track that ended is never a pause worth fighting, whichever way `advance` goes.
    cancelResume();
    if (takeTrackEndStop()) writeState("paused");
    else if (repeat === "one") restart(true);
    else advance(true);
  }, [advance, repeat, restart, writeState]);

  // A track nothing can play must not be the end of the queue. This is the shape of "playback
  // doesn't run on its own": one rotted source in the middle of a saved playlist — a stream id
  // that 404s a year after the song was saved — and every song after it never plays, with the
  // next one named on screen under "Next up" the whole time. Nobody is watching a queue, so
  // there is nobody to press Next.
  //
  // Hung off the state rather than off a give-up branch because there are four of them: `load`
  // ends here twice while resolving, and `handleError` twice more once a source has spoken. All
  // four write this state and nothing else does, so this is the one place that sees every way a
  // track can turn out to be dead.
  //
  // Keyed on `state` alone, deliberately. The effect that runs is the one belonging to the
  // render that turned unplayable, so `advance` reads that render's queue; re-running it because
  // `advance` took a new identity would step over a second track that never failed at all.
  useEffect(() => {
    if (state !== "unplayable") return;
    const verdict = judgeDeadTrack({
      chosenByHand: handPicked.current,
      skipped: deadSkips.current,
      queued: queueRef.current.length,
    });
    if (verdict !== "skip") return;

    const dead = songRef.current?.title ?? "a track";
    deadSkips.current += 1;
    // `false`, not `true`: with nowhere left to go this leaves the player exactly where it is,
    // still showing what went wrong, where `advance(true)` would wipe that to "idle". And the
    // line is logged only once it has actually moved — the last track of a queue reaches here
    // too, and a log that claims a skip nobody made is worse than no line at all.
    if (!advance(false)) return;
    log("warn", `Skipped “${dead}” — nothing here would play it`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const toggleShuffle = useCallback(() => {
    const modes = modeStore.getSnapshot();
    shuffled.current = new Set();
    modeStore.save({ ...modes, shuffle: !modes.shuffle });
  }, []);

  const stop = useCallback(() => {
    resolving.current?.abort();
    dropRadio();
    cancelResume();
    songRef.current = null;
    setPlaying(null);
    writeState("idle");
    setProblem(null);
    writeProgress(0, 0);
  }, [dropRadio, writeState]);

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
      writeIndex(0);
      void load(fresh[0]);
    },
    [load, notQueued, writeIndex, writeQueue],
  );

  const applyEdit = useCallback(
    (edit: QueueEdit | null) => {
      if (!edit) return;
      writeQueue(edit.queue);
      writeIndex(edit.index);
      if (edit.queue.length === 0) stop();
      else if (edit.play) void load(edit.play);
    },
    [load, stop, writeIndex, writeQueue],
  );

  // These three compute a whole replacement array and hand it to `writeQueue`, so they have to
  // read the queue the same way it does — from the ref. Reading the render's `queue` instead
  // is the mistake B-31 fixed for `enqueue` and left standing here: the radio append at the
  // bottom of this file lands asynchronously through `writeQueue`, so a click on ×, ↑ or ↓ in
  // the same tick replayed a snapshot taken before it and silently wiped the appended block —
  // or brought back a song that had just been removed.
  const removeAt = useCallback(
    (position: number) => {
      const song = queueRef.current[position];
      if (song) shuffled.current.delete(song.id);
      applyEdit(removeFromQueue(queueRef.current, indexRef.current, position));
    },
    [applyEdit],
  );

  const move = useCallback(
    (from: number, to: number) =>
      applyEdit(moveWithin(queueRef.current, indexRef.current, from, to)),
    [applyEdit],
  );

  const playNext = useCallback(
    (songs: Song[]) => {
      const queued = queueRef.current;
      const at = songs.length === 1 ? queued.findIndex((entry) => sameTrack(entry, songs[0])) : -1;
      const here = indexRef.current;
      if (at === -1) applyEdit(insertAfter(queued, here, notQueued(songs)));
      else if (at !== here && at !== here + 1) {
        applyEdit(moveWithin(queued, here, at, at < here ? here : here + 1));
      }
    },
    [applyEdit, notQueued],
  );

  const clearQueue = useCallback(() => {
    setQueueOrigin(null);
    writeQueue((queued) => queued.slice(0, indexRef.current + 1));
  }, [writeQueue]);

  useEffect(() => {
    const song = queue[index];
    if (!song || !activeSource || seededFor.current === song.id) return;
    seededFor.current = song.id;

    const params = new URLSearchParams({ title: song.title, limit: String(RADIO_POOL) });
    if (videoId) params.set("id", videoId);
    if (song.artists[0]) params.set("artist", song.artists[0]);

    const aborter = renew(radioRequest);
    let retry: ReturnType<typeof setTimeout> | undefined;

    // `seededFor` is claimed above, before the fetch, and every failure path used to leave it
    // claimed: the `!response.ok` branch turned a 429 into `null` and a bare `.catch` swallowed
    // the rest. Only `dropRadio()` releases it, and `load` calls that solely when the song *id*
    // changes — so one bad answer for the last song in a queue was final. `radio` stayed empty,
    // `hasNext` went false, `advance` fell through to `writeState("idle")`, and playback stopped
    // with no message, no retry and a greyed-out Next button: the "radio carries on when the
    // queue runs dry" promise failing silently on a single blip. Retry, and on giving up
    // release the claim so a later attempt at the same song can seed it again.
    const giveUp = (why: string) => {
      log("warn", `Radio: no picks for "${song.title}" — ${why}.`);
      if (seededFor.current === song.id) seededFor.current = null;
    };

    const seed = (attempt: number): void => {
      fetch(`/api/radio?${params}`, { signal: aborter.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`/api/radio answered ${response.status}`);
          return response.json() as Promise<SongsResponse>;
        })
        .then((data) => {
          if (aborter.signal.aborted || songRef.current?.id !== song.id) return;
          const queued = queueRef.current;
          const drawn = drawRadio(data.songs ?? [], {
            count: RADIO_PICKS,
            exclude: queued,
            avoid: getHistorySnapshot(),
          });
          const parked =
            indexRef.current < queued.length - 1 || !getPlaybackPrefs().continueWithRadio;
          setRadio(parked ? drawn : []);
          if (!parked && drawn.length > 0) writeQueue((current) => [...current, ...drawn]);
          // An empty draw is a successful request that still leaves the queue nowhere to go,
          // so it releases the claim too rather than pinning this song to no radio at all.
          if (drawn.length === 0) giveUp("the answer held nothing playable");
        })
        .catch((cause: unknown) => {
          if (aborter.signal.aborted || songRef.current?.id !== song.id) return;
          if (attempt < RADIO_RETRIES) {
            retry = setTimeout(() => seed(attempt + 1), RADIO_RETRY_MS);
            return;
          }
          giveUp(cause instanceof Error ? cause.message : String(cause));
        });
    };

    seed(0);

    return () => {
      clearTimeout(retry);
      if (songRef.current?.id !== song.id) aborter.abort();
    };
    // Seeding follows the source actually starting, which is why `queue` and `index` are left
    // out. `playing` is what all six of the values this used to list are read from, and listing
    // them separately meant the one with no value of its own — a subscription embed, identified
    // only by `subscriptionTrack` — never re-seeded: two Apple or Deezer songs in a row left
    // `seededFor` on the first. One dependency cannot fall out of step with its own derivations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

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

  // When a pause came from a press here. An embed reports the pause back within a beat, so a
  // report that arrives long after the last press is one nobody here asked for.
  const asked = useRef(0);
  const toggle = useCallback(() => {
    asked.current = Date.now();
    toggleRef.current?.();
  }, []);

  const seek = useCallback((seconds: number) => seekRef.current?.(seconds), []);

  // When anything was last touched. A press inside a cross-origin embed never reaches this
  // document as a click, but it does take the focus, so `blur` landing on an iframe counts as
  // one — that is what tells a listener pressing pause in YouTube's own chrome apart from
  // YouTube stopping an embed nobody has touched for an hour.
  useEffect(() => {
    const mark = () => {
      lastInteraction = Date.now();
    };
    // Seeded here rather than at the declaration, where `Date.now()` would be an impure call
    // during render. It matters that it is seeded at all: a pause in the first moments after a
    // load is the shape of a browser refusing to autoplay, not of a queue left alone.
    mark();

    const onBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) mark();
    };
    // Capture, so a handler that stops propagation cannot hide the interaction from this.
    document.addEventListener("pointerdown", mark, { capture: true, passive: true });
    document.addEventListener("keydown", mark, { capture: true, passive: true });
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", mark, { capture: true });
      document.removeEventListener("keydown", mark, { capture: true });
      window.removeEventListener("blur", onBlur);
      clearTimeout(resumeTimer);
    };
  }, []);

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
      const was = stateRef.current;
      writeState(next);

      // The log recorded which source refused and what it fell back to, but never that playback
      // simply stopped — the one thing it could not account for afterwards. Now it also does
      // something about it: a queue left alone is the case this exists for, and stopping dead
      // halfway through a playlist is not a state anyone asked for.
      if (next === "paused" && was === "playing") {
        const { position, duration } = progressSnapshot;
        const verdict = judgePause({
          now: Date.now(),
          askedAt: asked.current,
          interactedAt: lastInteraction,
          startedAt: sourceStartedAt,
          position,
          duration,
          readingAt: progressAt,
          resumes: unaskedResumes,
        });

        if (verdict !== "asked") {
          log(
            "warn",
            `Playback paused on its own (${activeSource ?? "no source"})${
              current ? ` during “${current.title}”` : ""
            } — ${describeVerdict(verdict, unaskedResumes)}.`,
          );
        }

        if (verdict === "resume") {
          unaskedResumes += 1;
          const songId = current?.id ?? null;
          clearTimeout(resumeTimer);
          resumeTimer = setTimeout(() => {
            // Everything may have moved on in the meantime — the listener came back and pressed
            // play, or the queue advanced. Only put back on the thing that stopped.
            if (stateRef.current !== "paused" || (songRef.current?.id ?? null) !== songId) return;
            toggleRef.current?.();
          }, RESUME_DELAY_MS);
        }
      }

      // A track that reached "playing" is proof the queue is getting somewhere, which is what
      // the dead-track skip's allowance is counted from — not from reaching a position, or a
      // playlist of alternating good and dead songs would never spend it and never stop.
      if (next === "playing") deadSkips.current = 0;

      if (next !== "playing" || !current || recorded.current === current.id) return;
      recorded.current = current.id;

      const { id, title, artists, artworkUrl, from } = current;
      const handle = playedHandle(current, activeSource, videoId);
      recordPlay({ id, title, artists, artworkUrl, from, videoId, url: null, ...handle });
    },
    [activeSource, current, videoId, writeState],
  );

  const handleError = useCallback(
    async (
      reason: string,
      worthRetrying: boolean,
      options: { stalled?: boolean; refused?: boolean; blocked?: boolean } = {},
    ) => {
      const song = songRef.current;
      if (song && steered.current) forgetFailedSource(song, steered.current);
      steered.current = null;
      const failures = youtubeFailures.current;
      const alreadyLeft = whyLeftYouTube(failures);
      if (options.blocked) failures.blocked = true;
      if (options.stalled) failures.stalled = true;
      if (options.refused) failures.refusals += 1;
      const leftYouTube = whyLeftYouTube(failures);
      if (leftYouTube && !alreadyLeft) {
        const why = failures.blocked
          ? "player never loaded"
          : failures.stalled
            ? "stalled"
            : `${failures.refusals} uploads refused`;
        log(
          "warn",
          `YouTube turned away the connection on “${song?.title ?? "playback"}” (${why}) — leaving YouTube`,
        );
        setYoutubeTurnedAway(leftYouTube);
      }

      if (!worthRetrying || !song) {
        log("error", `Gave up on ${song ? `“${song.title}”` : "playback"}: ${reason}`);
        writeState("unplayable");
        setProblem(reason);
        return;
      }

      const warn = (message: string) => log("warn", `“${song.title}” ${message}`);
      writeState("resolving");
      if (!leftYouTube) {
        try {
          // The id the song shipped with is one a provider asserted *is* this recording. Asking
          // search first and taking a result meant a Spotify track that fell through landed on
          // whatever the query surfaced — routinely a live cut or a cover — while its own copy
          // sat unused. Spend that one before asking for guesses.
          const shipped = youtubeIdOf(song);
          if (shipped && !attempted.current.has(shipped)) {
            warn(`fell back to the copy it shipped with (${shipped}): ${reason}`);
            return start({ kind: "ytmusic", id: shipped });
          }

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
      writeState("unplayable");
      setProblem(giveUpReason(attempted.current.size, triedProgressive, leftYouTube));
    },
    [adoptElsewhere, start, writeState],
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
    queueOrigin,
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
    volumeUnreachable,
    radio,
    shuffle,
    repeat,
    hasNext,
    play,
    goTo,
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
