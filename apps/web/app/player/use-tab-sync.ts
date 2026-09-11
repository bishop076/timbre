"use client";

import { useEffect, useRef } from "react";

import { createLocalStore, useLocalStore } from "../local-store.ts";
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
  type RemotePlayer,
  type SyncModel,
} from "./tab-sync";

interface TabSyncPlayer {
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

interface Link {
  model: SyncModel;
  post: (message: Message) => void;
  commit: (step: { model: SyncModel; message?: Message | null }) => void;
}

const remote = createLocalStore<RemotePlayer | null>({ initial: null });
let active: Link | null = null;
let tabId: string | null = null;

export function useRemotePlayer(): RemotePlayer | null {
  return useLocalStore(remote);
}

export function commandRemote(command: Command): void {
  const to = active?.model.remote?.tab;
  if (active && to) active.post({ type: "command", from: active.model.self, to, command });
}

export function takeOverRemote(): void {
  active?.commit(asking(active.model));
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
  if (command.action !== "seek") return player[command.action]();
  const { duration } = player.progress();
  player.seek(duration > 0 ? Math.min(command.seconds, duration) : command.seconds);
}

export function useTabSync(player: TabSyncPlayer): void {
  const latest = useRef(player);
  useEffect(() => {
    latest.current = player;
  });
  const pendingSeek = useRef<{ id: string; position: number } | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(CHANNEL);
    tabId ??= crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
    const link: Link = {
      model: initialModel(tabId),
      post: (message) => channel.postMessage(wire(message)),
      commit: ({ model, message }) => {
        link.model = model;
        remote.publish(model.remote);
        if (message) link.post(message);
      },
    };
    active = link;
    const hello = () => link.post({ type: "hello", from: link.model.self });

    const perform = (effect: Effect | null) => {
      const current = latest.current;
      switch (effect?.kind) {
        case "pause":
          if (current.state === "playing") current.toggle();
          return;
        case "announce":
          return announce(link, current);
        case "run":
          return run(effect.command, current);
        case "handoff":
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
        case "adopt": {
          const { queue, index, position, prefer } = effect.handoff;
          const song = queue[index]!;
          pendingSeek.current = position >= 1 ? { id: song.id, position } : null;
          current.play(song, queue.slice(index + 1), prefer ?? undefined);
        }
      }
    };

    const onMessage = (event: MessageEvent) => {
      const message = parseMessage(event.data);
      if (!message) return;
      const { state, current } = latest.current;
      const step = receive(link.model, message, { state, loaded: current !== null }, Date.now());
      link.commit(step);
      perform(step.effect);
    };

    const beat = window.setInterval(() => {
      if (owns(link.model)) return announce(link, latest.current);
      const step = tick(link.model, Date.now());
      link.commit(step);
      if (step.ping) hello();
    }, HEARTBEAT_MS);

    const onPageHide = () => link.commit(leaving(link.model));

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      hello();
      if (latest.current.state !== "playing") return;
      link.commit(localState({ ...link.model, sounding: false }, "playing", Date.now()));
    };

    channel.addEventListener("message", onMessage);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    hello();

    return () => {
      onPageHide();
      window.clearInterval(beat);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      channel.close();
      active = null;
      remote.publish(null);
    };
  }, [latest]);

  const { state, hasNext, index, seek } = player;
  const currentId = player.current?.id ?? null;
  const loaded = currentId !== null;

  useEffect(() => {
    if (active) active.commit(localSong(active.model, loaded));
  }, [currentId, loaded]);

  useEffect(() => {
    if (!active) return;
    const step = localState(active.model, state, Date.now());
    active.commit(step);
    if (step.pause) latest.current.toggle();
  }, [state, latest]);

  useEffect(() => {
    if (active) announce(active, latest.current);
  }, [currentId, state, hasNext, index, latest]);

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
  }, [currentId, state, seek, latest]);
}
