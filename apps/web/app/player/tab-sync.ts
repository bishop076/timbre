/**
 * **Tabs that agree about what is playing** — the protocol and the rules, with no browser in
 * them.
 *
 * Every tab has its own queue and its own players, so two Timbre tabs used to play at once,
 * and a second tab opened to look something up showed "Nothing playing" over the music
 * coming out of the first. Reported that way. Over a `BroadcastChannel` the tabs of one
 * browser now settle three things between themselves:
 *
 * - **One tab is audible.** A tab that starts playing *claims* the speakers, and any other
 *   tab that is playing pauses. The newest claim wins, because pressing play in a tab is a
 *   person saying "this one, now".
 * - **An empty tab mirrors the owner.** A tab with nothing queued shows the owner's song and
 *   can pause it, skip it and scrub it; the owner does the work and reports back.
 * - **The owner can be moved.** "Play here" asks the owner for its queue and position, starts
 *   it in the asking tab, and pauses the owner.
 *
 * No server and no account: a `BroadcastChannel` reaches only same-origin documents in the
 * same browser profile, which is exactly the set of tabs a person thinks of as "my Timbre".
 *
 * Everything here is pure — `receive` takes the model, a message and the local player's state
 * and returns the next model plus at most one thing for the tab to do — so the ownership rules
 * are tested without a browser. `use-tab-sync.ts` is the glue.
 */

import type { Song } from "../types";
import { usableSongs } from "../song-shape.ts";
import type { PlayState } from "./player-context";

export const CHANNEL = "timbre:player";

/**
 * Bumped on any change to a message's shape. Two tabs can be running different builds — one
 * opened before a deploy, one after — and a tab that reads a message it half-understands
 * does something wrong with it, where one that ignores it merely does nothing.
 */
const PROTOCOL = 1;

/** How often an owner reports. Once a second is enough for a clock the mirror smooths itself
 * (`Scrub` interpolates between reports), and it doubles as the heartbeat. */
export const HEARTBEAT_MS = 1000;

/**
 * Silence after which a mirror asks the owner whether it is still there.
 *
 * Asked rather than assumed, because the owner's own heartbeat is a timer and a browser
 * throttles the timers of a hidden tab — Chrome to once a minute for a tab hidden a while and
 * not making sound, which is exactly a paused owner in the background. A message is not a
 * timer: it is still delivered, and the owner answers it at once.
 */
export const PING_AFTER_MS = 2500;

/** Silence after which the owner is taken to be gone — crashed, killed, or frozen without a
 * `pagehide`. A few seconds, so a mirror never shows a song nobody is playing for long. */
export const STALE_AFTER_MS = 6000;

/** A tab's claim to be the audible one: which tab, and when it started playing. */
export interface Claim {
  tab: string;
  at: number;
}

/**
 * Whether claim `a` beats claim `b`. Later wins; a tie is broken by tab id so that two tabs
 * which claimed in the same millisecond still agree on one winner rather than both yielding.
 * `Date.now()` is one clock for every tab in a browser, which is what makes the times
 * comparable at all — `performance.now()` is per document and would not be.
 */
export function newer(a: Claim, b: Claim): boolean {
  return a.at !== b.at ? a.at > b.at : a.tab > b.tab;
}

/** What a mirror shows of the owner's song. Not the whole `Song`: the sources are the owner's
 * business until a take-over asks for them. */
export interface SongSummary {
  id: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
}

export function summarize(song: Song): SongSummary {
  return { id: song.id, title: song.title, artists: song.artists, artworkUrl: song.artworkUrl };
}

/** The owner's state, as a mirror renders it. */
export interface OwnerReport {
  song: SongSummary;
  state: PlayState;
  position: number;
  duration: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** What a mirror can ask the owner to do. */
export type Command =
  | { action: "toggle" }
  | { action: "next" }
  | { action: "previous" }
  | { action: "seek"; seconds: number };

/** The owner's queue, handed to a tab that asked to take over. */
export interface Handoff {
  queue: Song[];
  index: number;
  position: number;
  /** The source the owner was actually playing, so the new tab starts there rather than
   * walking the ladder again — which, for a song YouTube refuses on this connection, would
   * mean sitting through the same refusal before reaching the copy that played. */
  prefer: string | null;
}

export type Message =
  | { type: "claim"; from: string; at: number }
  | { type: "state"; from: string; at: number; report: OwnerReport }
  | { type: "gone"; from: string }
  | { type: "hello"; from: string }
  | { type: "command"; from: string; to: string; command: Command }
  | { type: "take"; from: string; to: string }
  | { type: "handoff"; from: string; to: string; handoff: Handoff };

/** What goes on the wire: a message, stamped with the protocol it was written in. */
export type Wire = Message & { v: typeof PROTOCOL };

export function wire(message: Message): Wire {
  return { ...message, v: PROTOCOL };
}

/*
 * ------------------------------------------------------------------------------------------
 * Validation. The channel is same-origin by construction, but a message is still input from
 * another document — possibly an older build, possibly one mid-teardown — and it is read
 * straight into the queue on a take-over. So nothing is used until its shape is checked.
 * ------------------------------------------------------------------------------------------
 */

const PLAY_STATES: readonly PlayState[] = [
  "idle",
  "resolving",
  "loading",
  "playing",
  "paused",
  "unplayable",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Tab ids are generated here and are short; anything else is not one of ours. */
function isTab(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64;
}

function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseSummary(value: unknown): SongSummary | null {
  if (!isRecord(value)) return null;
  const { id, title, artists, artworkUrl } = value;
  if (typeof id !== "string" || typeof title !== "string") return null;
  if (!Array.isArray(artists) || !artists.every((name) => typeof name === "string")) return null;
  return {
    id,
    title,
    artists: artists as string[],
    // Only a web address is drawn: this ends up in an `<img>`, via the artwork proxy.
    artworkUrl: typeof artworkUrl === "string" && /^https?:\/\//.test(artworkUrl) ? artworkUrl : null,
  };
}

function parseReport(value: unknown): OwnerReport | null {
  if (!isRecord(value)) return null;
  const song = parseSummary(value.song);
  const { state, position, duration, hasNext, hasPrevious } = value;
  if (!song || !PLAY_STATES.includes(state as PlayState)) return null;
  if (!isTime(position) || !isTime(duration)) return null;
  if (typeof hasNext !== "boolean" || typeof hasPrevious !== "boolean") return null;
  return { song, state: state as PlayState, position, duration, hasNext, hasPrevious };
}

function parseCommand(value: unknown): Command | null {
  if (!isRecord(value)) return null;
  const { action } = value;
  if (action === "toggle" || action === "next" || action === "previous") return { action };
  if (action === "seek" && isTime(value.seconds)) return { action, seconds: value.seconds };
  return null;
}

function parseHandoff(value: unknown): Handoff | null {
  if (!isRecord(value)) return null;
  const { queue, index, position, prefer } = value;
  if (!Array.isArray(queue) || queue.length === 0) return null;
  // All or nothing, unlike a stored list: `index` points into *this* array, and dropping a
  // bad entry would shift it onto a different song.
  const songs = usableSongs(queue);
  if (songs.length !== queue.length) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= songs.length) {
    return null;
  }
  if (!isTime(position)) return null;
  if (prefer !== null && typeof prefer !== "string") return null;
  return { queue: songs, index, position, prefer };
}

/** A message, or `null` for anything that is not a well-formed one of this protocol. */
export function parseMessage(data: unknown): Message | null {
  if (!isRecord(data) || data.v !== PROTOCOL || !isTab(data.from)) return null;
  const from = data.from;

  switch (data.type) {
    case "claim":
      return isTime(data.at) ? { type: "claim", from, at: data.at } : null;
    case "state": {
      const report = parseReport(data.report);
      return report && isTime(data.at) ? { type: "state", from, at: data.at, report } : null;
    }
    case "gone":
      return { type: "gone", from };
    case "hello":
      return { type: "hello", from };
    case "command": {
      const command = parseCommand(data.command);
      return command && isTab(data.to) ? { type: "command", from, to: data.to, command } : null;
    }
    case "take":
      return isTab(data.to) ? { type: "take", from, to: data.to } : null;
    case "handoff": {
      const handoff = parseHandoff(data.handoff);
      return handoff && isTab(data.to) ? { type: "handoff", from, to: data.to, handoff } : null;
    }
    default:
      return null;
  }
}

/*
 * ------------------------------------------------------------------------------------------
 * The model and its rules.
 * ------------------------------------------------------------------------------------------
 */

export interface SyncModel {
  /** This tab. */
  self: string;
  /** The newest claim heard — this tab's own included. Whoever holds it is the owner. */
  claim: Claim | null;
  /** The owner's last report, when the owner is another tab. */
  remote: { tab: string; report: OwnerReport } | null;
  /** When the owning tab was last heard from, for the heartbeat. */
  heardAt: number;
  /** When this tab last asked the owner whether it is still there. */
  pingedAt: number;
  /**
   * Deposed mid-load: pause the moment the load lands instead of claiming.
   *
   * A tab that is loading cannot be paused — there is nothing playing yet — and when its
   * player does start, that is a load finishing, not a person pressing play. Claiming then
   * would take the speakers back from the tab that was pressed *after* it. The case that
   * matters is ordinary: a queue auto-advancing into its next song just as the reader starts
   * something in another tab.
   */
  yieldOnPlay: boolean;
  /**
   * Whether this tab's player last settled on `playing` rather than on a stop — so a
   * `playing` that follows only a `loading` is the same listening carrying on: a buffer
   * draining, a seek landing, the queue moving to its next song. None of those is a person
   * pressing play, and an owner that re-claimed on them would pause a tab the reader had
   * just started a song in, if that tab happened to be mid-load at the time.
   */
  sounding: boolean;
  /** The owner this tab asked to take over from, so only the answer to that asking is
   * adopted — a handoff nobody asked for does not get to replace the queue. */
  asked: string | null;
}

export function initialModel(self: string): SyncModel {
  return {
    self,
    claim: null,
    remote: null,
    heardAt: 0,
    pingedAt: 0,
    yieldOnPlay: false,
    sounding: false,
    asked: null,
  };
}

export function owns(model: SyncModel): boolean {
  return model.claim?.tab === model.self;
}

/** What the local player is doing, as far as the rules care. */
export interface Local {
  state: PlayState;
  /** Whether this tab has a song — which is what separates an owner from a mirror. */
  loaded: boolean;
}

/** The one thing a message can ask of the tab that received it. */
export type Effect =
  | { kind: "pause" }
  | { kind: "announce" }
  | { kind: "run"; command: Command }
  | { kind: "handoff"; to: string }
  | { kind: "adopt"; handoff: Handoff };

export interface Step {
  model: SyncModel;
  effect: Effect | null;
}

/**
 * Takes in another tab's claim. A newer one moves ownership, and a tab that is playing yields
 * to it; an older one — a claim that crossed this tab's own on the way — changes nothing, and
 * its sender yields when this tab's claim reaches it.
 *
 * Only a claim that is *news* can pause anything. The owner repeats its claim in every report,
 * once a second, and the only way to pause a player from here is its toggle — which a second
 * press would undo.
 */
function acceptClaim(model: SyncModel, claim: Claim, local: Local, now: number): Step {
  const known = model.claim;
  if (known && known.tab !== claim.tab && newer(known, claim)) return { model, effect: null };

  const news = !known || known.tab !== claim.tab || claim.at > known.at;
  const next: SyncModel = {
    ...model,
    claim: known && known.tab === claim.tab && known.at > claim.at ? known : claim,
    remote: model.remote?.tab === claim.tab ? model.remote : null,
    heardAt: now,
  };
  if (!news) return { model: next, effect: null };

  if (local.state === "playing") return { model: next, effect: { kind: "pause" } };
  if (local.state === "loading" || local.state === "resolving") {
    return { model: { ...next, yieldOnPlay: true }, effect: null };
  }
  return { model: next, effect: null };
}

/** Folds one message from another tab into the model. */
export function receive(model: SyncModel, message: Message, local: Local, now: number): Step {
  if (message.from === model.self) return { model, effect: null };
  const mine = owns(model) && local.loaded;

  switch (message.type) {
    case "claim":
      return acceptClaim(model, { tab: message.from, at: message.at }, local, now);

    case "state": {
      // A report carries its sender's claim, so a tab opened after the claim went out still
      // learns who owns playback from the first report it hears.
      const step = acceptClaim(model, { tab: message.from, at: message.at }, local, now);
      // A report from a tab that has since been deposed: its last word before it heard.
      if (step.model.claim?.tab !== message.from) return step;
      return { model: { ...step.model, remote: { tab: message.from, report: message.report } }, effect: step.effect };
    }

    case "gone": {
      const wasOwner = model.claim?.tab === message.from;
      if (!wasOwner && model.remote?.tab !== message.from) return { model, effect: null };
      return {
        model: {
          ...model,
          claim: wasOwner ? null : model.claim,
          remote: null,
          asked: model.asked === message.from ? null : model.asked,
        },
        effect: null,
      };
    }

    case "hello":
      return { model, effect: mine ? { kind: "announce" } : null };

    case "command":
      return { model, effect: message.to === model.self && mine ? { kind: "run", command: message.command } : null };

    case "take":
      return { model, effect: message.to === model.self && mine ? { kind: "handoff", to: message.from } : null };

    case "handoff": {
      if (message.to !== model.self || model.asked !== message.from) return { model, effect: null };
      const next = { ...model, asked: null };
      // Something started here in the meantime: that was a later decision than the asking.
      if (local.loaded) return { model: next, effect: null };
      return { model: next, effect: { kind: "adopt", handoff: message.handoff } };
    }
  }
}

/**
 * The local player changed state. On `playing` this tab claims — or, deposed mid-load, pauses
 * instead (`yieldOnPlay`), or, already the owner and only carrying on, says nothing
 * (`sounding`). A tab that settles anywhere else drops a pending yield: the next `playing`
 * after a pause is a person pressing play.
 */
export function localState(
  model: SyncModel,
  state: PlayState,
  now: number,
): { model: SyncModel; message: Message | null; pause: boolean } {
  if (state === "playing") {
    const carryingOn = owns(model) && model.sounding;
    const next = { ...model, sounding: true };
    if (model.yieldOnPlay) return { model: { ...next, yieldOnPlay: false }, message: null, pause: true };
    if (carryingOn) return { model: next, message: null, pause: false };
    // Never behind the newest claim heard, whatever the clock says: this is the latest press
    // of play by construction, and an adjusted system clock should not make it lose.
    const at = Math.max(now, (model.claim?.at ?? 0) + 1);
    return {
      model: { ...next, claim: { tab: model.self, at }, remote: null },
      message: { type: "claim", from: model.self, at },
      pause: false,
    };
  }
  if (state === "paused" || state === "idle" || state === "unplayable") {
    return { model: { ...model, yieldOnPlay: false, sounding: false }, message: null, pause: false };
  }
  return { model, message: null, pause: false };
}

/**
 * The local song changed. A new song picked here is a new decision, so a yield owed from the
 * last one is dropped; an emptied queue gives ownership up, since there is nothing left to
 * report.
 */
export function localSong(model: SyncModel, loaded: boolean): { model: SyncModel; message: Message | null } {
  const next = model.yieldOnPlay ? { ...model, yieldOnPlay: false } : model;
  if (loaded || !owns(next)) return { model: next, message: null };
  return { model: { ...next, claim: null }, message: { type: "gone", from: model.self } };
}

/** The tab is going away. An owner says so, or its mirrors show it until the heartbeat
 * runs out. */
export function leaving(model: SyncModel): { model: SyncModel; message: Message | null } {
  if (!owns(model)) return { model, message: null };
  return { model: { ...model, claim: null }, message: { type: "gone", from: model.self } };
}

/** The heartbeat's other half: a mirror that has not heard from the owner asks, and one that
 * has not heard for longer lets it go. */
export function tick(model: SyncModel, now: number): { model: SyncModel; ping: boolean } {
  const other = model.claim && model.claim.tab !== model.self;
  if (!other && !model.remote) return { model, ping: false };

  const silent = now - model.heardAt;
  if (silent > STALE_AFTER_MS) {
    return {
      model: { ...model, claim: other ? null : model.claim, remote: null, asked: null },
      ping: false,
    };
  }
  if (silent > PING_AFTER_MS && now - model.pingedAt > PING_AFTER_MS) {
    return { model: { ...model, pingedAt: now }, ping: true };
  }
  return { model, ping: false };
}

/** A mirror asking to take over from the owner it shows. */
export function asking(model: SyncModel): { model: SyncModel; message: Message | null } {
  if (!model.remote) return { model, message: null };
  const to = model.remote.tab;
  return { model: { ...model, asked: to }, message: { type: "take", from: model.self, to } };
}
