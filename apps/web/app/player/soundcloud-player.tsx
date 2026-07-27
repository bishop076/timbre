"use client";

import { useEffect, useRef } from "react";

import { usePlayer } from "./player-context";

/**
 * The SoundCloud HTML5 Widget player.
 *
 * SoundCloud's own player, embedded unmodified — their stream, their branding,
 * their play counts. The Widget API needs **no credentials**, which is why
 * SoundCloud can be a real queue member while its catalogue stays out of reach.
 *
 * Deliberately mirrors `youtube-player.tsx`, including the parts that look
 * paranoid, because they were each paid for:
 *
 * 1. The widget replaces the iframe it is given, so a plain node is created
 *    imperatively for it to consume rather than one React manages.
 * 2. A load timeout, because an ad blocker or DNS filter can stop the widget
 *    script arriving and the bar would otherwise sit on a black box forever.
 * 3. Progress is polled. The widget reports `PLAY_PROGRESS`, but only while
 *    playing, so a timer is still needed to keep the bar honest when paused.
 */

interface SCWidget {
  bind(event: string, handler: (payload?: { currentPosition?: number }) => void): void;
  unbind(event: string): void;
  load(url: string, options: { callback?: () => void; auto_play?: boolean }): void;
  play(): void;
  pause(): void;
  seekTo(milliseconds: number): void;
  getDuration(callback: (duration: number) => void): void;
  getPosition(callback: (position: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
}

interface SCNamespace {
  Widget: ((element: HTMLIFrameElement) => SCWidget) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      ERROR: string;
      PLAY_PROGRESS: string;
    };
  };
}

declare global {
  interface Window {
    SC?: SCNamespace;
  }
}

const API_SRC = "https://w.soundcloud.com/player/api.js";

let apiPromise: Promise<SCNamespace> | null = null;

function loadApi(): Promise<SCNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<SCNamespace>((resolve, reject) => {
    if (window.SC?.Widget) {
      resolve(window.SC);
      return;
    }
    // Unlike YouTube's API, this script offers no ready callback — it just
    // defines window.SC — so the script's own load event is the handshake.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      if (window.SC?.Widget) resolve(window.SC);
      else reject(new Error("SoundCloud widget API loaded without SC.Widget."));
    });
    script.addEventListener("error", () => reject(new Error("SoundCloud widget API blocked.")));
    if (!existing) {
      script.src = API_SRC;
      script.async = true;
      document.head.append(script);
    }
  });

  return apiPromise;
}

/**
 * The widget takes the track's permalink, not an id.
 *
 * The track goes in the initial `src` rather than being pushed in later with
 * `load()`. Calling `load()` on a widget that already has this track resets it
 * and the `PLAY` event stops arriving — the track sits at 0:00 forever. So
 * `load()` is reserved for an actual track *change*.
 */
function widgetSrc(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "true",
    show_artwork: "true",
    visual: "false",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

export function SoundCloudPlayer({
  trackUrl,
  size = "w-full",
}: {
  trackUrl: string | null;
  /** Sizing only, for the same reason as {@link YouTubePlayer}'s. */
  size?: string;
}) {
  const {
    handleEnded,
    handleStateChange,
    handleProgress,
    handleError,
    registerToggle,
    registerSeek,
  } = usePlayer();

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<SCWidget | null>(null);
  const readyRef = useRef(false);
  /** The track the widget currently holds, so it is never pointlessly reloaded. */
  const loadedUrl = useRef<string | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || widgetRef.current) return;

    // An iframe of our own for the widget to attach to, so React never touches
    // the DOM the widget owns.
    // Nothing to mount until there is a track — the component is only rendered
    // when SoundCloud is the active source, so this is a transient state.
    if (!trackUrl) return;

    const host = document.createElement("iframe");
    host.width = "100%";
    host.height = "166";
    host.frameBorder = "no";
    host.scrolling = "no";
    // Both permissions are required. SoundCloud's own oEmbed markup declares
    // `autoplay; encrypted-media`, and without the latter the widget logs
    // "Permissions policy violation: encrypted-media is not allowed" and
    // refuses to start.
    host.allow = "autoplay; encrypted-media";
    host.src = widgetSrc(trackUrl);
    loadedUrl.current = trackUrl;
    container.append(host);

    let cancelled = false;

    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load SoundCloud's player. An ad blocker or network filter may be blocking it.",
          false,
        );
      }
    }, 8000);

    loadApi()
      .then((SC) => {
        if (cancelled) return;
        const widget = SC.Widget(host);
        widgetRef.current = widget;

        widget.bind(SC.Widget.Events.READY, () => {
          clearTimeout(blocked);
          readyRef.current = true;
          // The track is already in the iframe src, so nothing is loaded here.
          // `play()` covers the case where the browser refused the autoplay in
          // the URL; it is a no-op if playback already started.
          widget.play();
        });
        widget.bind(SC.Widget.Events.PLAY, () => handlers.current.handleStateChange("playing"));
        widget.bind(SC.Widget.Events.PAUSE, () => handlers.current.handleStateChange("paused"));
        widget.bind(SC.Widget.Events.FINISH, () => handlers.current.handleEnded());
        // The widget reports errors without a code, so there is nothing to
        // distinguish a private track from a geo-blocked one. Not retryable:
        // unlike YouTube there is no second upload to fall through to.
        widget.bind(SC.Widget.Events.ERROR, () =>
          handlers.current.handleError("SoundCloud couldn't play this track.", false),
        );
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(blocked);
        handlers.current.handleError("Couldn't load SoundCloud's player.", false);
      });

    return () => {
      cancelled = true;
      clearTimeout(blocked);
      widgetRef.current = null;
      readyRef.current = false;
      host.remove();
    };
    // `trackUrl` is deliberately not a dependency. It seeds the iframe's initial
    // src and must not re-run this effect, because tearing the widget down and
    // rebuilding it on every track change would restart the whole handshake.
    // Track *changes* are handled by the effect below, which calls load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only an actual track *change* reloads the widget. Reloading the track it
  // already holds resets it and stops PLAY events arriving.
  useEffect(() => {
    if (!trackUrl) return;
    if (loadedUrl.current === trackUrl) return;
    if (!readyRef.current || !widgetRef.current) return;

    loadedUrl.current = trackUrl;
    widgetRef.current.load(trackUrl, {
      // `callback` is more reliable than load()'s own auto_play flag.
      callback: () => widgetRef.current?.play(),
    });
  }, [trackUrl]);

  useEffect(() => {
    const timer = setInterval(() => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) return;
      widget.getDuration((duration) => {
        if (duration > 0) {
          widget.getPosition((position) =>
            handlers.current.handleProgress(position / 1000, duration / 1000),
          );
        }
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    registerSeek((seconds) => {
      if (!widgetRef.current || !readyRef.current) return;
      widgetRef.current.seekTo(seconds * 1000);
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  useEffect(() => {
    registerToggle(() => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) return;
      widget.isPaused((paused) => (paused ? widget.play() : widget.pause()));
    });
    return () => registerToggle(null);
  }, [registerToggle]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden bg-black ${size}`}
      aria-label="SoundCloud player"
    />
  );
}
