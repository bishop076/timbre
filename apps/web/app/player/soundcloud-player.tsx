"use client";

import { useCallback, useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

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

  apiPromise = apiPromise.catch((cause: unknown) => {
    apiPromise = null;
    throw cause;
  });
  return apiPromise;
}

const STALL_MS = 7000;

function widgetSrc(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "true",
    show_artwork: "true",
    visual: "false",
    show_teaser: "false",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
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
  const loadedUrl = useRef<string | null>(null);
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  const watchForStall = useCallback((widget: SCWidget) => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => {
      if (!readyRef.current || widgetRef.current !== widget) return;
      widget.getPosition((position) => {
        widget.isPaused((paused) => {
          if (position > 0 || !paused) return;
          handlers.current.handleError(
            "SoundCloud wouldn't start this track. It plays on soundcloud.com but refuses to start here — pick another source from the badges to hear it.",
            true,
          );
        });
      });
    }, STALL_MS);
  }, []);


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
    host.allow = "autoplay; encrypted-media";
    host.src = widgetSrc(trackUrl);
    loadedUrl.current = trackUrl;
    container.append(host);

    let cancelled = false;

    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load SoundCloud's player. An ad blocker or network filter may be blocking it.",
          true,
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
          widget.play();
          watchForStall(widget);
        });
        widget.bind(SC.Widget.Events.PLAY, () => handlers.current.handleStateChange("playing"));
        widget.bind(SC.Widget.Events.PLAY_PROGRESS, () => {
          if (stallTimer.current) {
            clearTimeout(stallTimer.current);
            stallTimer.current = null;
          }
        });
        widget.bind(SC.Widget.Events.PAUSE, () => handlers.current.handleStateChange("paused"));
        widget.bind(SC.Widget.Events.FINISH, () => handlers.current.handleEnded());
        widget.bind(SC.Widget.Events.ERROR, () =>
          handlers.current.handleError("SoundCloud couldn't play this track.", true),
        );
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(blocked);
        handlers.current.handleError("Couldn't load SoundCloud's player.", true);
      });

    return () => {
      cancelled = true;
      clearTimeout(blocked);
      if (stallTimer.current) clearTimeout(stallTimer.current);
      stallTimer.current = null;
      widgetRef.current = null;
      readyRef.current = false;
      host.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!trackUrl) return;
    if (loadedUrl.current === trackUrl) return;
    if (!readyRef.current || !widgetRef.current) return;

    const widget = widgetRef.current;
    loadedUrl.current = trackUrl;
    widget.load(trackUrl, {
      callback: () => {
        widget.play();
        watchForStall(widget);
      },
    });
  }, [trackUrl, watchForStall]);

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
            src={artworkUrl}
            alt=""
            aria-hidden
            className="max-h-full max-w-full rounded-[var(--r-md)] object-contain"
          />
        </div>
      )}
    </div>
  );
}
