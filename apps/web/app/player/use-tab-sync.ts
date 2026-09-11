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

/*
 * The browser half of `tab-sync.ts`: the channel, the heartbeat, and the player calls the
 * rules ask for. Called once, from `PlayerProvider`, which is the only thing that holds both
 * the queue and the controls.
 */

/** What the sync needs from the player. The provider passes its own values straight in. */
export interface TabSyncPlayer {
  queue: Song[];
  index: number;
  current: Song | null;
  state: PlayState;
  hasNext: boolean;
  activeSource: string | null;
  playingPreview: boolean;
  /** Read on demand rather than passed as values: the clock ticks outside React state, and
   * subscribing the provider to it would re-render the whole app twice a second. */
  progress: () => { position: number; duration: number };
  play: (song: Song, rest?: Song[], prefer?: string) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
}

/** The owner as a mirror shows it. */
export interface RemotePlayer {
  tab: string;
  report: OwnerReport;
}

/*
 * The mirror's view lives in a module-level store, like the progress clock in
 * `player-context.tsx` and for the same reason: it changes once a second while another tab
 * plays, and as part of the player context it would re-render every consumer on each report.
 * One provider per document makes module scope safe.
 */
let remoteSnapshot: RemotePlayer | null = null;
const remoteChanges = createNotifier();

/** How the remote bar reaches the channel; set while the provider is mounted. */
let outbox: { command: (command: Command) => void; takeOver: () => void } | null = null;

function publishRemote(next: RemotePlayer | null): void {
  if (next === remoteSnapshot) return;
  remoteSnapshot = next;
  remoteChanges.emit();
}

/** The tab that is playing, when it is another one — `null` otherwise, and on the server. */
export function useRemotePlayer(): RemotePlayer | null {
  return useSyncExternalStore(
    remoteChanges.subscribe,
    () => remoteSnapshot,
    () => null,
  );
}

/** Asks the tab that is playing to do something. A no-op with no channel or no owner. */
export function commandRemote(command: Command): void {
  outbox?.command(command);
}

/** Asks the tab that is playing for its queue, to carry on here. */
export function takeOverRemote(): void {
  outbox?.takeOver();
}

/** One id per document, so a remount under Strict Mode is still the same tab to the others. */
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

/** The owner's state, for a mirror. Nothing when there is no song to report. */
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
      // The same test the player bar disables Previous on.
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
      // Measured against this tab's clock, not the mirror's, which is up to a report behind.
      const { duration } = player.progress();
      player.seek(duration > 0 ? Math.min(command.seconds, duration) : command.seconds);
      return;
    }
  }
}

export function useTabSync(player: TabSyncPlayer): void {
  // The handlers below are bound once, for the life of the channel, and read the player
  // through this — the same pattern the embeds use for their callbacks.
  const latest = useRef(player);
  useEffect(() => {
    latest.current = player;
  });

  const linkRef = useRef<Link | null>(null);
  /** Where a take-over should resume, applied once the adopted song is actually playing:
   * neither `<audio>` nor YouTube can seek a source that has not loaded. */
  const pendingSeek = useRef<{ id: string; position: number } | null>(null);

  useEffect(() => {
    // Feature-detected, not assumed: without it every tab simply keeps to itself, as before.
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
          // A toggle is the only pause a player registers, so it is pressed only on a player
          // that is playing — on anything else it would be a play.
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
              // A preview names the catalogue the clip came from, and asking that source by
              // name gets its subscription embed instead — not what was playing.
              prefer: current.playingPreview ? null : current.activeSource,
            },
          });
          // Paused, not stopped: the queue stays here, so a take-over that fails in the other
          // tab loses nothing, and the new tab's claim deposes this one when it starts.
          // Paused now rather than then, so the song is not heard twice while it loads.
          if (current.state === "playing") current.toggle();
          return;
        }
        case "adopt": {
          const { queue, index, position, prefer } = effect.handoff;
          const song = queue[index]!;
          // What was already behind the playhead stays with the other tab: `play` starts a
          // queue at its first song, and that is the part worth carrying over.
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

    // One timer for both halves: an owner reports, anyone else checks the owner is alive.
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

    // Back from the back/forward cache, having given ownership up on the way in and missed
    // whatever was said while frozen: ask who plays now, and claim again if this tab still is.
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

    // Who is playing? An owner answers at once rather than at its next report.
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

  // Before the state effect, so a song picked here clears an owed yield before its
  // `playing` is looked at.
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

  // A change a mirror would show goes out now, not at the next heartbeat.
  useEffect(() => {
    const link = linkRef.current;
    if (link) announce(link, latest.current);
  }, [currentId, state, hasNext, index]);

  useEffect(() => {
    const pending = pendingSeek.current;
    if (!pending || !currentId) return;
    // Skipped past before it played: the position belonged to a song no longer here.
    if (currentId !== pending.id) {
      pendingSeek.current = null;
      return;
    }
    if (state !== "playing") return;
    // `playing` is not yet seekable. `<audio>` fires `play` the moment playback is asked for,
    // before its metadata is in, and a seek then is dropped — measured: the take-over resumed
    // at 0:00 every time. The first tick of the clock is what says the media is there.
    const poll = window.setInterval(() => {
      if (latest.current.progress().position <= 0) return;
      window.clearInterval(poll);
      pendingSeek.current = null;
      seek(pending.position);
    }, 100);
    return () => window.clearInterval(poll);
  }, [currentId, state, seek]);
}
