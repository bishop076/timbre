"use client";

import { useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

// The SoundCloud HTML5 Widget player, embedded unmodified. Mirrors `youtube-player.tsx`,
// including the parts that look paranoid: the widget *replaces* the iframe it is given, so
// the node is created imperatively rather than managed by React; a load timeout, because
// an ad blocker can stop the script arriving and leave the bar on a black box forever; and
// polling, since `PLAY_PROGRESS` only fires while playing.

interface SCWidget {
  bind(event: string, handler: (payload?: { currentPosition?: number }) => void): void;
  unbind(event: string): void;
  load(url: string, options: { callback?: () => void; auto_play?: boolean }): void;
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
    // No ready callback, unlike YouTube's API — it just defines window.SC, so the script's
    // own load event is the handshake.
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

// The widget takes the track's permalink, not an id, in the initial `src`. Calling
// `load()` on a widget that already holds this track resets it and `PLAY` stops arriving —
// the track sits at 0:00 forever — so `load()` is reserved for a track *change*.
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
    volume,
    muted,
    handleEnded,
    handleStateChange,
    handleProgress,
    handleError,
    registerToggle,
    registerSeek,
  } = usePlayerControls();

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<SCWidget | null>(null);
  const readyRef = useRef(false);
  /** The track the widget currently holds, so it is never pointlessly reloaded. */
  const loadedUrl = useRef<string | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  const level = muted ? 0 : volume;
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
    if (readyRef.current) widgetRef.current?.setVolume(level);
  }, [level]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || widgetRef.current) return;

    if (!trackUrl) return;

    const host = document.createElement("iframe");
    host.width = "100%";
    host.height = "166";
    host.frameBorder = "no";
    host.scrolling = "no";
    // Both required: without `encrypted-media` the widget logs a permissions policy
    // violation and refuses to start.
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
          widget.setVolume(levelRef.current);
          // The track is already in the iframe src; `play()` covers a browser that refused
          // the autoplay in the URL and is a no-op otherwise.
          widget.play();
        });
        widget.bind(SC.Widget.Events.PLAY, () => handlers.current.handleStateChange("playing"));
        widget.bind(SC.Widget.Events.PAUSE, () => handlers.current.handleStateChange("paused"));
        widget.bind(SC.Widget.Events.FINISH, () => handlers.current.handleEnded());
        // Errors arrive without a code, so a private track cannot be told from a geo-blocked
        // one. Not retryable — there is no second upload to fall through to.
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
    // `trackUrl` is deliberately not a dependency: it only seeds the iframe's initial src,
    // and re-running this would restart the handshake on every track change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only a track *change* reloads the widget — see `widgetSrc`.
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
