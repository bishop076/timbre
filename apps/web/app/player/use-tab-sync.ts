"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

import { createNotifier } from "../local-store.ts";
import type { Song } from "../types";
import type { PlayState } from "./player-context";
import {
  asking,
  CHANNEL,
  HEARTBEAT_MS,
  initialModel,
  leaving,
  localSong,
  localState,
  owns,
  parseMessage,
  receive,
  summarize,
  tick,
  wire,
  type Command,
  type Effect,
  type Message,
  type OwnerReport,
  type SyncModel,
} from "./tab-sync";

export interface TabSyncPlayer {
  queue: Song[];
  index: number;
  current: Song | null;
  state: PlayState;
  hasNext: boolean;
  activeSource: string | null;
  playingPreview: boolean;
  progress: () => { position: number; duration: number };
  play: (song: Song, rest?: Song[], prefer?: string) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
}

export interface RemotePlayer {
  tab: string;
  report: OwnerReport;
}

let remoteSnapshot: RemotePlayer | null = null;
const remoteChanges = createNotifier();

let outbox: { command: (command: Command) => void; takeOver: () => void } | null = null;

function publishRemote(next: RemotePlayer | null): void {
  if (next === remoteSnapshot) return;
  remoteSnapshot = next;
  remoteChanges.emit();
}

export function useRemotePlayer(): RemotePlayer | null {
  return useSyncExternalStore(
    remoteChanges.subscribe,
    () => remoteSnapshot,
    () => null,
  );
}

export function commandRemote(command: Command): void {
  outbox?.command(command);
}

export function takeOverRemote(): void {
  outbox?.takeOver();
}

let tabId: string | null = null;

function thisTab(): string {
  tabId ??=
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return tabId;
}

interface Link {
  model: SyncModel;
  post: (message: Message) => void;
  commit: (model: SyncModel) => void;
}

function announce(link: Link, player: TabSyncPlayer): void {
  const { model } = link;
  if (!owns(model) || !model.claim || !player.current) return;
  const { position, duration } = player.progress();
  link.post({
    type: "state",
    from: model.self,
    at: model.claim.at,
    report: {
      song: summarize(player.current),
      state: player.state,
      position,
      duration,
      hasNext: player.hasNext,
      hasPrevious: player.index > 0,
    },
  });
}

function run(command: Command, player: TabSyncPlayer): void {
  switch (command.action) {
    case "toggle":
      player.toggle();
      return;
    case "next":
      player.next();
      return;
    case "previous":
      player.previous();
      return;
    case "seek": {
      const { duration } = player.progress();
      player.seek(duration > 0 ? Math.min(command.seconds, duration) : command.seconds);
      return;
    }
  }
}

export function useTabSync(player: TabSyncPlayer): void {
  const latest = useRef(player);
  useEffect(() => {
    latest.current = player;
  });

  const linkRef = useRef<Link | null>(null);
  const pendingSeek = useRef<{ id: string; position: number } | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(CHANNEL);
    const link: Link = {
      model: initialModel(thisTab()),
      post: (message) => channel.postMessage(wire(message)),
      commit: (model) => {
        link.model = model;
        publishRemote(model.remote);
      },
    };
    linkRef.current = link;

    const perform = (effect: Effect | null) => {
      if (!effect) return;
      const current = latest.current;
      switch (effect.kind) {
        case "pause":
          if (current.state === "playing") current.toggle();
          return;
        case "announce":
          announce(link, current);
          return;
        case "run":
          run(effect.command, current);
          return;
        case "handoff": {
          if (!current.current) return;
          link.post({
            type: "handoff",
            from: link.model.self,
            to: effect.to,
            handoff: {
              queue: current.queue,
              index: current.index,
              position: current.progress().position,
              prefer: current.playingPreview ? null : current.activeSource,
            },
          });
          if (current.state === "playing") current.toggle();
          return;
        }
        case "adopt": {
          const { queue, index, position, prefer } = effect.handoff;
          const song = queue[index]!;
          pendingSeek.current = position >= 1 ? { id: song.id, position } : null;
          current.play(song, queue.slice(index + 1), prefer ?? undefined);
          return;
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      const message = parseMessage(event.data);
      if (!message) return;
      const current = latest.current;
      const step = receive(
        link.model,
        message,
        { state: current.state, loaded: current.current !== null },
        Date.now(),
      );
      link.commit(step.model);
      perform(step.effect);
    };

    const beat = window.setInterval(() => {
      if (owns(link.model)) {
        announce(link, latest.current);
        return;
      }
      const step = tick(link.model, Date.now());
      link.commit(step.model);
      if (step.ping) link.post({ type: "hello", from: link.model.self });
    }, HEARTBEAT_MS);

    const onPageHide = () => {
      const step = leaving(link.model);
      link.commit(step.model);
      if (step.message) link.post(step.message);
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      link.post({ type: "hello", from: link.model.self });
      const current = latest.current;
      if (current.state !== "playing") return;
      const step = localState({ ...link.model, sounding: false }, "playing", Date.now());
      link.commit(step.model);
      if (step.message) link.post(step.message);
    };

    channel.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    outbox = {
      command: (command) => {
        const to = link.model.remote?.tab;
        if (to) link.post({ type: "command", from: link.model.self, to, command });
      },
      takeOver: () => {
        const step = asking(link.model);
        link.commit(step.model);
        if (step.message) link.post(step.message);
      },
    };

    link.post({ type: "hello", from: link.model.self });

    return () => {
      onPageHide();
      window.clearInterval(beat);
      channel.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      channel.close();
      linkRef.current = null;
      outbox = null;
      publishRemote(null);
    };
  }, []);

  const { state, hasNext, index, seek } = player;
  const currentId = player.current?.id ?? null;
  const loaded = currentId !== null;

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    const step = localSong(link.model, loaded);
    link.commit(step.model);
    if (step.message) link.post(step.message);
  }, [currentId, loaded]);

  useEffect(() => {
    const link = linkRef.current;
    if (!link) return;
    const step = localState(link.model, state, Date.now());
    link.commit(step.model);
    if (step.message) link.post(step.message);
    if (step.pause) latest.current.toggle();
  }, [state]);

  useEffect(() => {
    const link = linkRef.current;
    if (link) announce(link, latest.current);
  }, [currentId, state, hasNext, index]);

  useEffect(() => {
    const pending = pendingSeek.current;
    if (!pending || !currentId) return;
    if (currentId !== pending.id) {
      pendingSeek.current = null;
      return;
    }
    if (state !== "playing") return;
    const poll = window.setInterval(() => {
      if (latest.current.progress().position <= 0) return;
      window.clearInterval(poll);
      pendingSeek.current = null;
      seek(pending.position);
    }, 100);
    return () => window.clearInterval(poll);
  }, [currentId, state, seek]);
}
