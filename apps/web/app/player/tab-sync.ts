import type { Song } from "../types";
import { usableSongs } from "../song-shape.ts";
import type { PlayState } from "./player-context";

export const CHANNEL = "timbre:player";

const PROTOCOL = 1;

export const HEARTBEAT_MS = 1000;

export const PING_AFTER_MS = 2500;

export const STALE_AFTER_MS = 6000;

export interface Claim {
  tab: string;
  at: number;
}

export function newer(a: Claim, b: Claim): boolean {
  return a.at !== b.at ? a.at > b.at : a.tab > b.tab;
}

export interface SongSummary {
  id: string;
  title: string;
  artists: string[];
  artworkUrl: string | null;
}

export function summarize(song: Song): SongSummary {
  return { id: song.id, title: song.title, artists: song.artists, artworkUrl: song.artworkUrl };
}

export interface OwnerReport {
  song: SongSummary;
  state: PlayState;
  position: number;
  duration: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export type Command =
  | { action: "toggle" }
  | { action: "next" }
  | { action: "previous" }
  | { action: "seek"; seconds: number };

export interface Handoff {
  queue: Song[];
  index: number;
  position: number;
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

export type Wire = Message & { v: typeof PROTOCOL };

export function wire(message: Message): Wire {
  return { ...message, v: PROTOCOL };
}

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
  const songs = usableSongs(queue);
  if (songs.length !== queue.length) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= songs.length) {
    return null;
  }
  if (!isTime(position)) return null;
  if (prefer !== null && typeof prefer !== "string") return null;
  return { queue: songs, index, position, prefer };
}

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

export interface SyncModel {
  self: string;
  claim: Claim | null;
  remote: { tab: string; report: OwnerReport } | null;
  heardAt: number;
  pingedAt: number;
  yieldOnPlay: boolean;
  sounding: boolean;
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

export interface Local {
  state: PlayState;
  loaded: boolean;
}

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

export function receive(model: SyncModel, message: Message, local: Local, now: number): Step {
  if (message.from === model.self) return { model, effect: null };
  const mine = owns(model) && local.loaded;

  switch (message.type) {
    case "claim":
      return acceptClaim(model, { tab: message.from, at: message.at }, local, now);

    case "state": {
      const step = acceptClaim(model, { tab: message.from, at: message.at }, local, now);
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
      if (local.loaded) return { model: next, effect: null };
      return { model: next, effect: { kind: "adopt", handoff: message.handoff } };
    }
  }
}

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

export function localSong(model: SyncModel, loaded: boolean): { model: SyncModel; message: Message | null } {
  const next = model.yieldOnPlay ? { ...model, yieldOnPlay: false } : model;
  if (loaded || !owns(next)) return { model: next, message: null };
  return { model: { ...next, claim: null }, message: { type: "gone", from: model.self } };
}

export function leaving(model: SyncModel): { model: SyncModel; message: Message | null } {
  if (!owns(model)) return { model, message: null };
  return { model: { ...model, claim: null }, message: { type: "gone", from: model.self } };
}

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

export function asking(model: SyncModel): { model: SyncModel; message: Message | null } {
  if (!model.remote) return { model, message: null };
  const to = model.remote.tab;
  return { model: { ...model, asked: to }, message: { type: "take", from: model.self, to } };
}
