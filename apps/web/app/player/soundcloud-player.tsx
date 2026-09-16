"use client";

import { useCallback, useEffect, useRef } from "react";

import { hideWhenBroken } from "../artwork";
import { proxied } from "../artwork-url";
import { blockedReason, blockedTimer, loadGlobal, useLatest, useTransport } from "./embed";
import { usePlayerControls } from "./player-context";
import { widgetHandoff, widgetStep } from "./soundcloud-handshake.ts";
import { judgeSoundCloudStart, type StartReading } from "./soundcloud-stall.ts";

interface SCWidget {
  bind(event: string, handler: () => void): void;
  load(url: string, options: { callback?: () => void }): void;
  play(): void;
  pause(): void;
  setVolume(level: number): void;
  seekTo(milliseconds: number): void;
  getDuration(callback: (duration: number) => void): void;
  getPosition(callback: (position: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
}

interface SCNamespace {
  Widget: ((element: HTMLIFrameElement) => SCWidget) & {
    Events: Record<"READY" | "PLAY" | "PAUSE" | "FINISH" | "ERROR" | "PLAY_PROGRESS", string>;
  };
}

declare global {
  interface Window {
    SC?: SCNamespace;
  }
}

const API_SRC = "https://w.soundcloud.com/player/api.js";
const STALL_MS = 7000;
/**
 * How long the widget gets to answer a question about itself before the silence is the answer.
 * A healthy widget is answering `getDuration` twice a second from the poll below, so this is
 * generous by an order of magnitude and only ever expires on one that has stopped listening.
 */
const ANSWER_MS = 2000;
const STALL_REASON =
  "SoundCloud wouldn't start this track. It plays on soundcloud.com but refuses to start here — pick another source from the badges to hear it.";

const loadApi = loadGlobal(API_SRC, () => (window.SC?.Widget ? window.SC : undefined));

function widgetSrc(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "true",
    show_artwork: "true",
    visual: "false",
    show_teaser: "false",
  });
  return `https://w.soundcloud.com/player/?${params}`;
}

export function SoundCloudPlayer({
  trackUrl,
  artworkUrl,
  expanded = false,
  size = "w-full",
}: {
  trackUrl: string | null;
  artworkUrl?: string | null;
  expanded?: boolean;
  size?: string;
}) {
  const controls = usePlayerControls();
  const level = controls.muted ? 0 : controls.volume;

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<SCWidget | null>(null);
  const readyRef = useRef(false);
  // What should be playing, and what the widget actually has. They come apart during the
  // handshake and during a `load`, which is the whole of `soundcloud-handshake.ts`.
  const wantedUrl = useRef(trackUrl);
  const holdingUrl = useRef<string | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const answerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // This mount's verdict on the widget, kept for the same reason `apiBlocked` is kept for the
  // page in `youtube-player.tsx`: the deadline that reaches it runs once, and this is the one
  // player the ladder can hand a second url without remounting. See `widgetHandoff`.
  const failed = useRef(false);

  const live = useLatest({ ...controls, level });

  const start = useCallback(
    (widget: SCWidget) => {
      widget.play();
      // Per track, not per component: each `start` is one song's attempt at getting going, and
      // the reprieve it is allowed belongs to that attempt.
      let reprieves = 0;

      const watch = (): void => {
        clearTimeout(stallTimer.current);
        stallTimer.current = setTimeout(() => {
          if (!readyRef.current || widgetRef.current !== widget) return;

          let settled = false;
          const settle = (reading: StartReading | null) => {
            if (settled || widgetRef.current !== widget) return;
            settled = true;
            clearTimeout(answerTimer.current);
            const verdict = judgeSoundCloudStart(reading, reprieves);
            if (verdict === "playing") return;
            if (verdict === "wait") {
              reprieves += 1;
              watch();
              return;
            }
            live.current.handleError(STALL_REASON, true);
          };

          // Both readings come back over the same channel that has already gone quiet, so the
          // question needs its own deadline. Without one this whole guard was unreachable for
          // the failure that matters most — a widget that answers nothing at all — and a dead
          // track stopped the queue with "playing" on screen until the tab was closed.
          answerTimer.current = setTimeout(() => settle(null), ANSWER_MS);
          widget.getPosition((position) => {
            widget.isPaused((paused) => settle({ position, paused }));
          });
        }, STALL_MS);
      };

      watch();
    },
    [live],
  );

  // The one place the widget is told what to do, so READY and a track change cannot disagree.
  const apply = useCallback((widget: SCWidget) => {
    const step = widgetStep(holdingUrl.current, wantedUrl.current);
    if (step.do === "load") {
      holdingUrl.current = step.url;
      widget.load(step.url, { callback: () => start(widget) });
    } else if (step.do === "play") {
      start(widget);
    }
  }, [start]);

  useEffect(() => {
    if (readyRef.current) widgetRef.current?.setVolume(level);
  }, [level]);

  useEffect(() => {
    const container = containerRef.current;
    const initialUrl = wantedUrl.current;
    if (!container || !initialUrl) return;
    holdingUrl.current = initialUrl;

    const host = Object.assign(document.createElement("iframe"), {
      // A frame with no title is announced as "frame" and nothing else. This one is a
      // whole embedded player, so it is a real stop on the way through the page.
      title: "SoundCloud player",
      width: "100%",
      height: "166",
      frameBorder: "no",
      scrolling: "no",
      allow: "autoplay; encrypted-media",
      src: widgetSrc(initialUrl),
    });
    container.append(host);

    let cancelled = false;
    const clearBlocked = blockedTimer("SoundCloud", (reason) => {
      failed.current = true;
      live.current.handleError(reason, true);
    });

    loadApi()
      .then((SC) => {
        if (cancelled) return;
        const widget = SC.Widget(host);
        widgetRef.current = widget;
        const { Events } = SC.Widget;

        widget.bind(Events.READY, () => {
          clearBlocked();
          // A widget that turned up late is a working widget, whatever the deadline decided.
          failed.current = false;
          readyRef.current = true;
          widget.setVolume(live.current.level);
          apply(widget);
        });
        widget.bind(Events.PLAY, () => live.current.handleStateChange("playing"));
        widget.bind(Events.PLAY_PROGRESS, () => clearTimeout(stallTimer.current));
        widget.bind(Events.PAUSE, () => live.current.handleStateChange("paused"));
        widget.bind(Events.FINISH, () => live.current.handleEnded());
        widget.bind(Events.ERROR, () =>
          live.current.handleError("SoundCloud couldn't play this track.", true),
        );
      })
      .catch(() => {
        if (cancelled) return;
        clearBlocked();
        failed.current = true;
        live.current.handleError("Couldn't load SoundCloud's player.", true);
      });

    const poll = setInterval(() => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) return;
      widget.getDuration((duration) => {
        if (duration > 0) {
          widget.getPosition((position) =>
            live.current.handleProgress(position / 1000, duration / 1000),
          );
        }
      });
    }, 500);

    return () => {
      cancelled = true;
      clearBlocked();
      clearTimeout(stallTimer.current);
      clearTimeout(answerTimer.current);
      clearInterval(poll);
      widgetRef.current = null;
      readyRef.current = false;
      holdingUrl.current = null;
      host.remove();
    };
  }, [apply, live]);

  // A track change that lands during the widget's ~0.5–2s handshake was dropped. Recording the
  // new url was not enough on its own: `readyRef` is a ref, so READY firing a moment later
  // re-ran nothing and played whatever the iframe was built with. The component is not
  // remounted between two SoundCloud tracks — `load` batches `setPlaying(null)` and
  // `start(own)` into one commit, so `activeSource` never passes through `null` — so the
  // previous track kept playing under the new one's artwork, and its FINISH advanced the queue
  // from the wrong position. Record what is wanted either way; `apply` reconciles it whenever
  // the widget is in a state to be told, whether that is now or at READY.
  useEffect(() => {
    wantedUrl.current = trackUrl;
    const widget = widgetRef.current;
    const handoff = widgetHandoff(trackUrl, {
      ready: readyRef.current && widget !== null,
      failed: failed.current,
    });
    if (handoff === "apply" && widget) apply(widget);
    // Nothing here can load this url and no deadline is left to say so, so say it now rather
    // than leave the track on "SoundCloud 0:00" with the ladder waiting on a widget that is
    // not coming. Retryable: SoundCloud being unreachable says nothing about the rungs below it.
    else if (handoff === "report") live.current.handleError(blockedReason("SoundCloud"), true);
  }, [apply, live, trackUrl]);

  useTransport({
    toggle: () => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) return;
      widget.isPaused((paused) => (paused ? widget.play() : widget.pause()));
    },
    seek: (seconds) => {
      if (readyRef.current) widgetRef.current?.seekTo(seconds * 1000);
    },
  });

  return (
    <div className={`flex flex-col overflow-hidden bg-black ${size}`}>
      <div
        ref={containerRef}
        className="h-[166px] w-full shrink-0 overflow-hidden"
        aria-label="SoundCloud player"
      />
      {expanded && artworkUrl && (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={proxied(artworkUrl) ?? undefined}
            alt=""
            aria-hidden
            {...hideWhenBroken}
            className="max-h-full max-w-full rounded-[var(--r-md)] object-contain"
          />
        </div>
      )}
    </div>
  );
}
