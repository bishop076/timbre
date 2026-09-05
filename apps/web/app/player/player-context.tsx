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
import type { Song, SongsResponse } from "../types";
import { recordPlay } from "./history-store";
import { playedHandle } from "./played-handle";
import { moveWithin, removeAt as removeFromQueue, type QueueEdit } from "./queue-ops";
import { plausiblySameSong } from "./song-match";
import { isProgressive, streamUrlFor, type ProgressiveSource } from "./stream-url";
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

/** A player is mounted and holds the song: it can be started over rather than re-loaded. */
function settled(state: PlayState): boolean {
  return state === "playing" || state === "paused";
}

/** `off` continues into the recommendations at queue end; `all` loops the queue; `one` repeats a track. */
export type RepeatMode = "off" | "all" | "one";

interface PlayerState {
  queue: Song[];
  index: number;
  current: Song | null;
  videoId: string | null;
  soundcloudUrl: string | null;
  /** What the `<audio>` element is pointed at, for the sources Timbre plays itself. Built
   * from the source and its id by `stream-url.ts`; see there on why Audius's is a redirect
   * rather than a resolved link. */
  streamUrl: string | null;
  /** The Spotify track whose embed is showing, if any. Nothing can start it — the embed has
   * no play API — so this is a panel the reader taps, never a queue member. */
  spotifyTrackId: string | null;
  /** The subscription embed on screen, if any — Apple Music or Deezer. Their own players,
   * which play the whole song for someone signed in and a clip for everyone else. */
  subscriptionTrack: { source: "apple" | "deezer"; id: string } | null;
  /** The Mixcloud show the widget holds. Its `key` — `/user/slug/` — not the display URL,
   * whose user segment is the display name and which the widget refuses. */
  mixcloudKey: string | null;
  /** Which player owns the current song. Exactly one is ever mounted — a paused one can be restarted by a stray event. */
  activeSource: PlayingSource | null;
  /** The current audio is a catalogue's thirty-second clip, not the song. */
  playingPreview: boolean;
  /** Whether the now-playing panel is shown. Hiding only clips the player: the IFrame API stops playback below 200×200 (BUGS.md B-1). */
  panelOpen: boolean;
  /** Whether the panel fills the content area. Same element either way — re-parenting the iframe would reload it and kill playback. */
  theater: boolean;
  state: PlayState;
  problem: string | null;
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

/** Held apart from the rest of the state: these two tick, and nothing else does. */
interface PlayerProgress {
  position: number;
  duration: number;
}

interface PlayerActions {
  /** Plays a song, optionally queueing the list it came from behind it.
   *
   * `prefer` names a source to try before the usual ladder — what a source badge passes when
   * the reader picks one. It is a preference, not a constraint: a source that cannot be
   * started falls through to the normal order. */
  play: (song: Song, rest?: Song[], prefer?: string) => void;
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
  /** `stalled` marks a YouTube copy that loaded and never delivered media — a refusal of
   * the address, not the upload — so the ladder leaves YouTube instead of walking its copies. */
  handleError: (reason: string, worthRetrying: boolean, options?: { stalled?: boolean }) => void;
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

/** The player minus the clock: one context, because all of it changes at human speed. */
type PlayerControls = PlayerState & PlayerActions;

/*
 * Progress is a store rather than state here: it arrives about twice a second, and as one field
 * of the context value it re-rendered every consumer on every tick — the sidebar, both
 * transports, the embeds and every queue button included.
 */
const ZERO_PROGRESS: PlayerProgress = { position: 0, duration: 0 };
const ticks = createNotifier();
let progressSnapshot = ZERO_PROGRESS;

function writeProgress(position: number, duration: number): void {
  // A paused player keeps reporting the same second, which `setState` used to swallow.
  if (position === progressSnapshot.position && duration === progressSnapshot.duration) return;
  progressSnapshot = { position, duration };
  ticks.emit();
}

const PlayerContext = createContext<PlayerControls | null>(null);

/** Everything but the clock. Prefer it: this re-renders only on a change a listener made. */
export function usePlayerControls(): PlayerControls {
  const context = useContext(PlayerContext);
  if (!context) throw new Error("usePlayer must be used inside <PlayerProvider>.");
  return context;
}

/** Position and duration. Only what draws a clock should subscribe. */
export function usePlayerProgress(): PlayerProgress {
  return useSyncExternalStore(ticks.subscribe, () => progressSnapshot, () => ZERO_PROGRESS);
}

/** Controls and clock, as before — so it re-renders on the tick. */
export function usePlayer(): PlayerControls & PlayerProgress {
  const controls = usePlayerControls();
  const progress = usePlayerProgress();
  return useMemo(() => ({ ...controls, ...progress }), [controls, progress]);
}

function youtubeIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "ytmusic")?.sourceId ?? null;
}

/** The SoundCloud copy, if any. Returns `url`, not `sourceId` — the widget takes a permalink. */
function soundcloudUrlOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "soundcloud")?.url ?? null;
}

/**
 * Why a song stopped, in the reader's terms rather than the code's.
 *
 * The single message this replaced — "every copy of this song blocks playback outside
 * YouTube" — was written when YouTube was the only source that could fail. It now fires for
 * a song with no YouTube copy at all, and for one that failed on Audius or the archive,
 * where it is simply untrue. A wrong explanation is worse than a vague one: it sends the
 * reader looking for a cause that is not there.
 */
/**
 * What to say when every rung has refused.
 *
 * **Reports the observation, never the cause.** This used to read *"All 5 copies on YouTube
 * block playback outside it"*, which names a cause — an uploader disabling embedding —
 * that nothing here measured. Measured 2026-08-20 from a Swiss exit, that exact sentence was
 * shown for a song barred by **territory**, on a video advertising `playableInEmbed: true`
 * and 246 available countries. An ad blocker produces the same sentence again. B-6 is on
 * record for this mistake and its remedy was the same: say what was seen.
 *
 * "nothing else could either" is safe where a stronger claim would not be — it reports that
 * the ladder ran out, which is true by construction here. It deliberately does not say no
 * other source *has* a copy: `adoptElsewhere` may have been spent on this song already, or
 * its search may have failed outright, and neither is a search that came back empty.
 */
function giveUpReason(youtubeCopies: number, triedProgressive: boolean): string {
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

/** The Mixcloud show, if any. Returns the `key`, which is what the widget takes. */
function mixcloudKeyOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "mixcloud")?.sourceId ?? null;
}

/** The Spotify copy, if any. `manual` is its own tier: it plays, but only when a person
 * presses it, so it is reached last and never auto-advanced into. */
function spotifyIdOf(song: Song): string | null {
  return song.sources.find((source) => source.source === "spotify")?.sourceId ?? null;
}

/** The first copy Timbre can play itself, if any. Sources are already ordered most-playable
 * first by the merger, so this takes whichever progressive one it meets. */
function progressiveOf(song: Song): { source: ProgressiveSource; sourceId: string } | null {
  const found = song.sources.find((source) => isProgressive(source.source));
  return found && isProgressive(found.source) ? { source: found.source, sourceId: found.sourceId } : null;
}

/** Every source that can end up in the player, including the two that only ever supply a
 * preview clip. */
type PlayingSource =
  | "ytmusic"
  | "soundcloud"
  | "spotify"
  | "mixcloud"
  | "deezer"
  | "apple"
  | ProgressiveSource;

/** A catalogue's own thirty-second clip, for a song no source will play in full. Sources
 * are ordered most-playable first, so this takes whichever offers one. */
function previewOf(song: Song): { source: PlayingSource; url: string } | null {
  const found = song.sources.find((source) => Boolean(source.previewUrl));
  return found?.previewUrl ? { source: found.source as PlayingSource, url: found.previewUrl } : null;
}

/** What `load` would do for a source the reader named, or `null` when this song has no copy
 * there that can be started. Described rather than performed, so the badge offering the
 * choice and the player honouring it read the same answer from one place. */
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

  // **Apple and Deezer get their own player here, not their preview clip.**
  //
  // The ladder still falls to the thirty-second file — that is `previewOf`, untouched, and
  // it is the right floor because it starts by script and advances the queue. But a reader
  // who *names* one of these is asking for that service, and the service can do better than
  // a clip: both embeds play the whole song for someone signed in. Offering the file to
  // someone with a subscription would be the worse answer to a question they asked
  // deliberately.
  //
  // Falls back to the clip when there is no id to embed, so the badge never goes dead.
  if (source === "apple" || source === "deezer") {
    if (track.sourceId) return { kind: "subscription", source, id: track.sourceId };
  }

  return track.previewUrl ? { kind: "preview", source: source as PlayingSource, url: track.previewUrl } : null;
}

/** How a named source would play, for a control deciding what to offer.
 *
 * `queue` is the song; `manual` embeds but rests until pressed; `preview` is thirty seconds
 * and must be labelled as such; `null` means this song cannot be started there at all.
 *
 * **This mirrors the ladder in `load` and has to stay in step with it.** A badge that offers
 * to play and then does nothing is worse than one that only links out, and the two live far
 * enough apart to drift — which is why both read `chosenSource` rather than each testing the
 * song themselves. */
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
  /**
   * The queue, readable synchronously — every write goes through {@link writeQueue}.
   *
   * **This exists because `goTo` needs the queue as it *will be*, not as it was when the
   * callback closed over it.** `advance` appends the radio and immediately calls
   * `goTo(queue.length)` (see `docs/BUGS.md` B-8), so the closure's copy is one item short.
   *
   * That used to be solved by reading inside a `setQueue` updater and calling `load` from
   * within it — and React runs updaters during the **render** phase. `load` writes progress,
   * `writeProgress` notifies the progress store synchronously, and a subscriber set state
   * while `PlayerProvider` was rendering: *"Cannot update a component (`PlayerBar`) while
   * rendering a different component (`PlayerProvider`)"*. Reported as a console error.
   *
   * A ref kept in step at every write gives `goTo` the same freshness with no work inside
   * render at all.
   */
  const queueRef = useRef<Song[]>([]);
  const [index, setIndex] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [soundcloudUrl, setSoundcloudUrl] = useState<string | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [spotifyTrackId, setSpotifyTrackId] = useState<string | null>(null);
  const [subscriptionTrack, setSubscriptionTrack] = useState<{ source: "apple" | "deezer"; id: string } | null>(null);
  const [mixcloudKey, setMixcloudKey] = useState<string | null>(null);
  // `deezer` and `apple` appear here only as the source of a **preview** — they have no
  // player of their own. Naming them is the point: the badge has to say where the thirty
  // seconds came from, and claiming another source played it would be a lie.
  const [activeSource, setActiveSource] = useState<PlayingSource | null>(null);
  const [playingPreview, setPlayingPreview] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [theater, setTheater] = useState(false);
  const [state, setState] = useState<PlayState>("idle");
  // Read by `restart`, which runs from event handlers and needs the committed state rather
  // than whatever was closed over when the handler was created.
  const stateRef = useRef<PlayState>("idle");
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [problem, setProblem] = useState<string | null>(null);
  const [radio, setRadio] = useState<Song[]>([]);
  // Remembered across reloads, like the volume: a listener who shuffles expects to still be
  // shuffling after a refresh.
  const { shuffle, repeat } = useLocalStore(modeStore);
  // Played in this shuffle pass. A pass restarts only once every song has played.
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
  /** Songs already re-searched across every source, so a rescue that finds nothing playable
   * cannot bounce back into `load` forever. Keyed by the original id, which a rescue keeps. */
  const rescued = useRef<Set<string>>(new Set());
  /** The song the radio was last fetched for. The deps below fire on every load attempt,
   * and only this keeps a fall-through from re-asking for a list already held. */
  const seededFor = useRef<string | null>(null);

  /** Whether the self-played copy has already had its turn on this song, so a failure there
   * cannot loop straight back into it. YouTube copies are tracked individually in
   * `attempted`; a song carries at most one progressive copy, so one flag is the whole state. */
  const progressiveTried = useRef(false);
  /** The preview is the floor of the ladder; without this a clip that fails re-offers itself. */
  const previewTried = useRef(false);
  // The same once-per-song guard for SoundCloud. `soundcloud-player.tsx` describes it as
  // already existing, and reported its refusals as final because it did not: the ladder
  // gave up on a song listed on four sources because the one that refused was SoundCloud.
  const soundcloudTried = useRef(false);
  /** The Spotify track already offered for this song, so the give-up path cannot loop into
   * the same embed it just showed. */
  const activeSourceRefSpotify = useRef<string | null>(null);
  // The song already written to history. Held per id so a pause/resume, or a fall-through to
  // another copy, does not record twice; see `handleStateChange`.
  const recorded = useRef<string | null>(null);

  /** The only way the queue is written. Keeps {@link queueRef} in step in the same tick, so
   * a caller that appends and then navigates sees what it just added. */
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

  /** Shows the embed and stops. There is no `loading` here and never a `playing`: nothing
   * can start a Spotify embed but the reader, so the queue rests on this entry until they
   * do — which is the point. Silently skipping a song someone queued is worse. */
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
    // No "press it to start" any more: Spotify's Embed iFrame API can be script-started, so
    // `spotify-player.tsx` calls `play()` on ready like every other player here. See that
    // file for what changed and for the §IV.2 judgement it now rests on.
    setProblem(null);
    setState("loading");
  }, []);

  /**
   * **Apple Music and Deezer, through their own players rather than their preview clips.**
   *
   * These two are `link` sources: they cannot be searched into the queue and Timbre plays
   * them as the thirty-second file each catalogue publishes. That clip is the right floor
   * for the fall-through ladder — it starts by script and advances the queue — but it is
   * *not* the best either service can do for the reader in front of it.
   *
   * Both publish an embeddable player, and both play **the whole song for someone signed
   * in** — Apple's own marketing-tools documentation says so outright, and its embed carries
   * a Sign In button. Measured 2026-08-20: `embed.music.apple.com/us/song/{id}` and
   * `widget.deezer.com/widget/dark/track/{id}` both render a working player with no key, no
   * account of ours and no `X-Frame-Options`.
   *
   * It is `manual`, exactly like Spotify, and for the same reason: no play API, so nothing
   * here can start it or hear it end. That is why this is reached only when the reader names
   * the source — the ladder must never *land* on a panel that cannot advance.
   */
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

  /**
   * **The floor of the ladder: thirty seconds, honestly labelled.**
   *
   * Deezer and Apple publish a preview clip on the very search responses Timbre already
   * reads. For a song only they carry — an independent single with no YouTube upload, no
   * Audius copy and an ISRC too obscure for MusicBrainz — that clip is the difference
   * between hearing something and reading "no copy of this song exists". Reported exactly
   * that way, on "Just Because of You (feat. Henneysee)": Apple and Deezer both had it, and
   * every one of YouTube's ten answers was a different song.
   *
   * Reached only after everything real has refused, and it says what it is: a clip that
   * announced itself as the song would be a worse answer than the refusal it replaces.
   */
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

  /** Everything the search can find that is plausibly this song, on any source. */
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

  /**
   * **The rung that lets the ladder leave the song's own sources.**
   *
   * Searches every source for another copy of this recording and adopts the first one
   * something can actually play, rewriting the queue entry so the repair sticks. Returns
   * whether it started a player.
   *
   * Every other rung — `progressiveOf`, `soundcloudUrlOf`, `spotifyIdOf`, `previewOf` —
   * reads `song.sources`, so for a merge that carries only YouTube uploads they are all
   * empty *by construction*: when those uploads turn out to be barred there is nothing
   * below to fall to, and the song is declared unplayable while a playable copy sits on
   * screen as a separate search row. Measured 2026-08-20 from a Swiss exit — 6 of 12 songs
   * had every YouTube copy barred, and all 6 had a full-length SoundCloud copy the ladder
   * could not reach. See `docs/RESEARCH-VPN-FALLTHROUGH.md`, and B-4, whose named remedy
   * this is.
   *
   * Shared by `load` and `handleError` rather than written twice. They are the two halves of
   * one ladder and this file has already paid for hand-copied sequences once — see `advance`
   * and B-8, where a skip and a track ending drifted apart.
   *
   * **Once per song.** `rescued` is keyed on the original id, which a repair keeps, so a
   * rescue that lands on something equally dead cannot send the ladder round again.
   *
   * `mixcloud` is the one difference between the callers, and it is not a preference.
   * `handleError` arrives from a song that played as a *track*, so an hour-long set sharing
   * its name is the wrong answer — the failure `plausiblySameSong` exists to stop, which it
   * catches on duration only when the show reports one, and Mixcloud's `audio_length` is
   * optional. `load` arrives from a song with nothing playable at all, where a show usually
   * is the answer.
   */
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
      // The match's sources are adopted under the *original* id, and the queue entry is
      // replaced rather than played around: `recordPlay` reads the source off the song it
      // finds there, so leaving the old one in place would write the same broken row back
      // and the tile would need rescuing again next time.
      songRef.current = repaired;
      writeQueue((current) => current.map((entry) => (entry.id === song.id ? repaired : entry)));

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
      // Unreachable: `elsewhere` was chosen by the same four tests against the same sources.
      return false;
    },
    [attemptMixcloud, attemptProgressive, attemptSoundCloud, attemptSpotify, writeQueue],
  );

  const load = useCallback(
    async (song: Song, prefer?: string) => {
      resolving.current?.abort();
      const aborter = new AbortController();
      resolving.current = aborter;

      songRef.current = song;
      candidates.current = [];
      attempted.current = new Set();
      progressiveTried.current = false;
      previewTried.current = false;
      soundcloudTried.current = false;
      setPlayingPreview(false);
      activeSourceRefSpotify.current = null;
      // Cleared on every deliberate (re)start: repeat-one re-loads the *same* id, and the
      // per-id guard otherwise swallowed every play after the first.
      recorded.current = null;
      // Seeded with the length the *song* already carries rather than zero. Every source
      // reports its own duration eventually, but "eventually" is a player handshake away,
      // and until then a bar left at zero shows `—:—` — or, worse, whatever the last track
      // put there. A three-hour Mixcloud set showing another song's 3:22 was reported.
      writeProgress(0, song.durationMs ? song.durationMs / 1000 : 0);
      setActiveSource(null);
      setVideoId(null);
      setSoundcloudUrl(null);
      setStreamUrl(null);
      setSpotifyTrackId(null);
      setSubscriptionTrack(null);
      setMixcloudKey(null);

      // **What the reader asked for beats what the ladder guesses.** The order below is an
      // estimate of which source is most likely to work; a named source is not an estimate,
      // and the person naming it can usually see that the default is failing — which is the
      // whole point of the control, since a territory can bar YouTube's copies while
      // SoundCloud plays the same song in full.
      //
      // `ytmusic` is deliberately not handled here: it is what the ladder already tries
      // first, and that path also warms the fall-through list, so intercepting it would
      // trade a behaviour for nothing. Anything the named source cannot start falls through
      // to the usual order rather than stranding a song something else could have played.
      if (prefer && prefer !== "ytmusic") {
        const chosen = chosenSource(song, prefer);
        if (chosen) {
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

        // Warm the fall-through list while the first copy is still loading (`docs/BUGS.md`
        // B-5). Resolving on failure instead cost fail → round trip → retry, which a
        // listener hears as a stall part-way through a song; doing it now costs a request
        // nobody waits on. Deliberately not awaited, and guarded twice: the abort signal
        // cancels it on a track change, and the song check drops a response that lands
        // after one anyway, so a stale list can never be attempted for the wrong song.
        void findCandidates(song, aborter.signal)
          .then((found) => {
            if (songRef.current === song) candidates.current = found;
          })
          .catch(() => {
            // A failed prefetch is not a failure: `handleError` still fetches on demand.
          });
        return;
      }

      // A source Timbre plays itself comes before SoundCloud: all of them play, but these
      // are reached by search or by a recommendation rather than only by a pasted URL, so
      // they are the ones a listener can actually arrive at.
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

      /*
       * **Spotify used to return here, and that was the whole bug.**
       *
       * The comment said "last, and only when nothing else here can play it" — and it was
       * true of the sources already *on* the song, which is not the same thing. A pasted
       * Spotify link resolves to a Spotify-only song, because `resolveUrl` asks the one
       * provider that owns the URL and no other. So the ladder reached Spotify with nothing
       * beside it, showed the embed, and the reader got thirty seconds.
       *
       * Measured: *never stay* by almogfx — the track this was found on — is on **SoundCloud,
       * YouTube Music, Deezer and Apple**. Two of those play it whole. The search below finds
       * them in one request; it simply was never reached.
       *
       * So Spotify is held rather than taken, and the search runs first. If it turns up a copy
       * something can actually play, that wins. If it turns up nothing, Spotify's embed is
       * still there at the bottom — which is what "last resort" was always supposed to mean.
       *
       * A reader who *names* Spotify on a badge still gets Spotify: that path returns above,
       * before any of this.
       */
      const spotify = spotifyIdOf(song);

      setState("resolving");
      setProblem(null);

      try {
        const matches = await findMatches(song, aborter.signal);
        candidates.current = matches.map(youtubeIdOf).filter((id): id is string => id !== null);
        const first = candidates.current[0];
        if (first) {
          attempt(first);
          return;
        }

        // **Nothing on YouTube Music, but the search reaches every source.** Reaching here
        // means no source on the song could be played — which for a "Recently played" tile
        // usually means the row was written before histories stored a source at all, not
        // that the show is gone. Mixcloud shows and Audius uploads are not on YouTube, so
        // the old message was both wrong and a dead end.
        //
        // Mixcloud is allowed here and refused in `handleError`: a song that arrives with no
        // sources at all is very often a pre-2026-08-19 history row for a show, so a show is
        // the likely right answer. See `adoptElsewhere`.
        if (adoptElsewhere(song, matches, { mixcloud: true })) return;

        // Nothing playable was found, so the embed is genuinely the last resort now.
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
      findMatches,
    ],
  );

  /**
   * Plays the loaded song again from the top, without reloading it.
   *
   * `load` clears every player handle and the `attempt*` that follows sets one back — in the
   * same synchronous batch. For the song already loaded that is the value the handle already
   * had, so React reconciles nothing and no player's load effect re-runs: nothing called
   * `loadVideoById` or `audio.play()`, and the bar sat on a spinner at 0:00 until the reader
   * pressed play. Repeat-one reached it at the end of every song, repeat-all on a one-song
   * queue, Previous on the first song, and picking the playing song again.
   *
   * `ended` is passed by the callers that know the player has stopped: YouTube's `ENDED`
   * never reaches `handleStateChange`, so the context still reads "playing" at that moment
   * and would otherwise leave a finished video sitting at its first frame.
   */
  const restart = useCallback((ended: boolean) => {
    // A deliberate replay is a play, and history should say so — as `load` does.
    recorded.current = null;
    seekRef.current?.(0);
    if (ended || stateRef.current !== "playing") toggleRef.current?.();
  }, []);

  const play = useCallback(
    (song: Song, rest: Song[] = [], prefer?: string) => {
      const others = rest.filter((candidate) => candidate.id !== song.id);
      const loaded = songRef.current;

      // The song already playing, asked for by name from a source badge: keep the queue it
      // is in and only change where it plays from. Replacing the queue with `[song]` threw
      // away everything queued after it — and the radio continuation — to switch source.
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
      // Reads the ref, not a `setQueue` updater — see `queueRef` for what that cost.
      const target = queueRef.current[nextIndex];
      if (!target) return;
      setIndex(nextIndex);
      // The song a player already holds is started over, not re-loaded — see `restart`.
      if (target.id === songRef.current?.id && settled(stateRef.current)) {
        restart(false);
        return;
      }
      void load(target);
    },
    [load, restart],
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
        // The same position again — repeat-all on a one-song queue — is a restart, and at a
        // song's end the player has stopped in a way the context cannot see (`restart`).
        if (target === index && fromEnd) restart(true);
        else goTo(target);
        return;
      }

      const fresh = unqueued(radio);
      if (fresh.length === 0) {
        if (fromEnd) setState("idle");
        return;
      }

      writeQueue((current) => [...current, ...fresh]);
      setRadio([]);
      // Where the old queue ended, *not* `index + 1`. Those match only when the
      // current song is last — in shuffle a spent pass returns null from any
      // position, so `index + 1` landed on a played song and left the radio unplayed.
      goTo(queue.length);
    },
    [goTo, index, nextIndex, queue, radio, restart, unqueued, writeQueue],
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

  /**
   * Tears the players down — `queue-ops` asks for this when an edit empties the queue.
   *
   * **Every handle, not the two the queue started with.** `now-playing.tsx` chooses its
   * player from these fields, so one left set keeps that player mounted and playing a song
   * that is no longer in the queue. Clearing `videoId` and `soundcloudUrl` alone meant
   * removing the last entry while an Audius track played left the `<audio>` element running
   * — and with `current` now null the bar unmounts, so there was not even a pause button to
   * reach for. Mixcloud's widget did the same.
   */
  const stop = useCallback(() => {
    resolving.current?.abort();
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

  const enqueue = useCallback(
    (songs: Song[]) => {
      // Against the ref rather than `unqueued`, which reads the render-time queue for
      // `hasNext`: two additions in one tick would each see the queue without the other.
      const known = new Set(queueRef.current.map((song) => song.id));
      const fresh = songs.filter((song) => !known.has(song.id));
      if (fresh.length === 0) return;

      // Adding to an empty queue must start playback, or nothing loads the song.
      if (queueRef.current.length === 0) {
        writeQueue(fresh);
        setIndex(0);
        void load(fresh[0]!);
        return;
      }

      // Through the ref, like every other writer: the render-time `queue` is stale the
      // moment another write lands in the same tick, and appending to it dropped that write.
      writeQueue((current) => [...current, ...fresh]);
    },
    [load, writeQueue],
  );

  /** Applies an edit from `queue-ops`, which owns the index arithmetic. */
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
    writeQueue((current) => current.slice(0, index + 1));
  }, [index, writeQueue]);

  // Read by the radio effect but not depended on — as a dep it refetches on every append.
  // `queueRef` is declared at the top and kept in step by `writeQueue`, so only the index
  // needs syncing here.
  const indexRef = useRef(index);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Seeded from the copy that actually **played**, and from the song's own title and artist
  // regardless, because those are all some sources can use. Requiring a YouTube id here meant
  // a self-played or SoundCloud track fetched no radio at all, so the queue simply stopped at
  // its end rather than continuing.
  //
  // **Once per song, not once per attempt.** A song whose first uploads refuse to embed
  // walks the candidate list, and each attempt changed `videoId` and fired another radio
  // request — measured on *Wonderwall*: three uploads, three `/api/radio` calls in 1.5
  // seconds, for one song. `seededFor` keys on the song, so a fall-through re-seeds nothing.
  //
  // Gating on `state === "playing"` instead would seed from the copy that actually survived,
  // which is a slightly better seed — and was tried and rejected. It makes the radio depend
  // on a state the player may never reach: an embed that never starts then yields no
  // recommendations at all, so the queue stops dead at its end. Three wasted requests is a
  // far cheaper failure than a queue that will not continue.
  useEffect(() => {
    const song = queue[index];
    if (!song || !activeSource) return;
    if (seededFor.current === song.id) return;
    seededFor.current = song.id;

    const seed = activeSource === "ytmusic" ? videoId : null;

    const params = new URLSearchParams({ title: song.title, limit: "25" });
    if (seed) params.set("id", seed);
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
        if (fresh.length > 0) writeQueue((current) => [...current, ...fresh]);
      })
      .catch(() => {
        // No recommendations is not worth surfacing: the queue still plays.
      });

    return () => {
      // Every fall-through re-runs this effect for the *same* song, and `seededFor` then
      // stops the re-run from asking again — so cancelling here on each one left a song
      // whose first copy refused with no radio at all, and the queue died at its end. Only
      // a change of song makes this request stale. `songRef` rather than the index ref:
      // `load` sets it synchronously, before any state this cleanup could observe.
      if (songRef.current?.id !== song.id) aborter.abort();
    };
    // Keyed on whatever is actually loaded — see the ref note above.
    //
    // **Every handle, not just some.** Exactly one of these is non-null at a time, so a
    // missing one means an entire source never re-seeds. `mixcloudKey` was absent: playing a
    // second Mixcloud show in a row changed nothing here, so no radio was fetched and "up
    // next" stayed empty. Reported exactly that way. `spotifyTrackId` had the same hole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource, videoId, streamUrl, soundcloudUrl, mixcloudKey, spotifyTrackId]);

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

  // On "playing": `load` counts copies that refused and `handleEnded` misses skips.
  const handleStateChange = useCallback(
    (next: PlayState) => {
      setState(next);
      if (next !== "playing") return;

      const song = queue[index];
      if (!song || recorded.current === song.id) return;
      recorded.current = song.id;

      // The source that actually played, so replaying from history reaches the same place.
      // Recording only `videoId` meant everything else came back as "no source", and the
      // player then searched YouTube Music for the title and played whatever it found.
      const handle = playedHandle(song, activeSource, videoId);

      recordPlay({
        id: song.id,
        title: song.title,
        artists: song.artists,
        artworkUrl: song.artworkUrl,
        // The upload that played, not the one the song shipped with — only it can seed a radio.
        videoId,
        source: handle?.source,
        sourceId: handle?.sourceId,
        url: handle?.url ?? null,
      });
    },
    [queue, index, videoId, activeSource],
  );

  const handleError = useCallback(
    async (reason: string, worthRetrying: boolean, options: { stalled?: boolean } = {}) => {
      const song = songRef.current;

      // **Falling through means trying another copy of this song, not another song.**
      // `findCandidates` searches YouTube Music by title and artist, which is a *fall-through*
      // only when the song is on YouTube Music to begin with — every candidate is then another
      // upload of the same recording. For a song that lives somewhere else it is a guess, and
      // a guess played as if it were the thing asked for.
      //
      // A Mixcloud show failed and the search for *"I'm laughing, but I just might cry"*
      // returned a cat video, which then played, badged YT Music. Reported exactly that way.
      // Long-form and independent uploads have no YouTube equivalent to find, and their titles
      // are ordinary sentences that match anything.
      const onYouTube = song?.sources.some((source) => source.source === "ytmusic") ?? false;

      if (!worthRetrying || !song) {
        log("error", `Gave up on ${song ? `“${song.title}”` : "playback"}: ${reason}`);
        setState("unplayable");
        setProblem(reason);
        return;
      }

      setState("resolving");
      try {
        // Skipped entirely for a song YouTube Music does not carry — the *other* sources
        // below are still offered, because those are real copies of this recording rather
        // than a search for its name.
        // **A stall is not this upload's fault, so the other uploads are not tried.** Every
        // copy is served by the same googlevideo.com edge to the same address, and a 403
        // there answers the address, not the video — measured 2026-08-30, two songs, both
        // stalled identically (B-18). Walking five candidates at `STALL_MS` each would be
        // fifty seconds of spinner before the ladder reached a source that could play. A
        // coded error still walks them, because 100/101/150 genuinely are per-upload.
        const searchForCopies = onYouTube && !options.stalled;
        // Copies `load` already found for a song that is not on YouTube Music itself — a
        // history row with nothing playable, repaired by search — are walked too. They passed
        // `plausiblySameSong` to get onto the list, and skipping them meant one barred upload
        // sent the ladder straight past two that would have played. The *search* stays
        // gated on `onYouTube`; only the list already in hand is not.
        const tryAnotherCopy = searchForCopies || (!options.stalled && candidates.current.length > 0);
        if (searchForCopies && candidates.current.length === 0) {
          // Cancel the previous, or a fall-through mid-`load` leaves it running and its
          // response overwrites `candidates` for a song no longer playing.
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

      // Once per song, like `progressiveTried`. SoundCloud's player reports its refusals as
      // worth retrying, so a song it shares with YouTube Music, Deezer and Apple is not given
      // up on because the one source that refused was the one being tried — and without
      // this guard that report would walk straight back in here and restart the track that
      // had just refused, for ever.
      const soundcloud = soundcloudUrlOf(song);
      if (soundcloud && !soundcloudTried.current) {
        log(
          "warn",
          `“${song.title}” fell back to SoundCloud after ${attempted.current.size} YouTube copies refused`,
        );
        attemptSoundCloud(soundcloud);
        return;
      }

      // **Everything the song carries has now refused, so leave the song.** Below this point
      // the ladder used to hold only a thirty-second clip and a give-up, both read off the
      // same exhausted `sources` — so a YouTube-only merge whose copies were barred died
      // here with a full-length copy of the same recording one search away. `load` has run
      // this rescue since `5e66598`; the failure path never called it, which is the whole of
      // `docs/RESEARCH-VPN-FALLTHROUGH.md`.
      //
      // Above the preview deliberately: a copy that plays in full beats thirty seconds. The
      // search is bounded to one per song by `rescued`, and every candidate has to pass
      // `plausiblySameSong` — without that guard this is the cat-video failure again, which
      // is why it is a filtered search and not a search.
      // The spent-rescue test is `adoptElsewhere`'s own, repeated here only so a second
      // failure on an already-rescued song does not pay for a search whose answer is dropped.
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
          // A failed rescue is not a failure of its own: the preview and the give-up below
          // are still the right answer. An abort means a track change already took over.
          if (cause instanceof DOMException && cause.name === "AbortError") return;
        }
      }

      /*
       * **Spotify last, which is where `load` already keeps it.**
       *
       * This rung used to sit second, above the song's own SoundCloud copy and above the
       * rescue. `load` holds it to the bottom and says why at length: the embed is what you
       * take when nothing can play the song, and reaching it early means taking it while
       * something still could. The two ladders are the same ladder and had drifted — the
       * failure this file has already paid for once in `advance`, B-8.
       *
       * Both orderings were defensible until `spotify/preview-mode.ts` measured the thing
       * that settles it: in a browser that does not send `sp_dc` to a third-party frame —
       * a blocker, shields, or a setting — Spotify's embed serves **thirty seconds** to a
       * Premium subscriber as readily as to a stranger, and nothing on this side can change
       * it. So this rung is not reliably a full song at all, and ranking it above a
       * SoundCloud copy that is one traded the whole track for a clip.
       *
       * Not gated on `spotifyPreviewsOnly()`, though it is tempting. That flag is only true
       * *after* a clip has been served once, so the first Spotify track of every session
       * would still be ranked as a full song and still be a clip. The ordering has to be
       * right before the evidence arrives, not after.
       */
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
      setProblem(giveUpReason(attempted.current.size, progressiveTried.current));
    },
    // No `attemptMixcloud`: Mixcloud is never a *fall-through* target, only a deliberate
    // pick. Its hits are hour-long mixes that merely share a name with the song — falling
    // back from a four-minute track to an 88-minute set called *Wonderwall* would be a worse
    // answer than admitting nothing here can play it.
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
    // Repeat-one ignores the queue entirely; everything else is `advance`, which also
    // continues into the recommendations at queue end.
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

  // No memo: with the tick in its own store this component re-renders only when one of these
  // changed. The callbacks are still individually memoised, so their identities are unchanged.
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
