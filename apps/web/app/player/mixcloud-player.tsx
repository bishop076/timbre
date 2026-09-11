"use client";

import { useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

interface MixcloudEvent<T extends unknown[]> {
  on(handler: (...args: T) => void): void;
  off?(handler: (...args: T) => void): void;
}

interface MixcloudWidget {
  ready: Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(seconds: number): Promise<boolean>;
  getPosition(): Promise<number>;
  getDuration(): Promise<number>;
  getIsPaused(): Promise<boolean>;
  events: {
    play: MixcloudEvent<[]>;
    pause: MixcloudEvent<[]>;
    ended: MixcloudEvent<[]>;
    error: MixcloudEvent<[unknown]>;
    progress: MixcloudEvent<[number, number]>;
  };
}

declare global {
  interface Window {
    Mixcloud?: { PlayerWidget(element: HTMLIFrameElement): MixcloudWidget };
  }
}

const API_SRC = "https://widget.mixcloud.com/media/js/widgetApi.js";

let apiPromise: Promise<NonNullable<Window["Mixcloud"]>> | null = null;

function loadApi(): Promise<NonNullable<Window["Mixcloud"]>> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    if (window.Mixcloud) {
      resolve(window.Mixcloud);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      if (window.Mixcloud) resolve(window.Mixcloud);
      else reject(new Error("Mixcloud widget API loaded without Mixcloud."));
    });
    script.addEventListener("error", () => reject(new Error("Mixcloud widget API blocked.")));
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

function widgetSrc(key: string): string {
  return `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(key)}&mini=1&light=0&autoplay=1`;
}

export function MixcloudPlayer({
  cloudcastKey,
  artworkUrl,
  size = "w-full",
}: {
  cloudcastKey: string | null;
  artworkUrl?: string | null;
  size?: string;
}) {
  const {
    handleEnded,
    handleStateChange,
    handleProgress,
    handleError,
    registerToggle,
    registerSeek,
  } = usePlayerControls();

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<MixcloudWidget | null>(null);
  const readyRef = useRef(false);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cloudcastKey) return;

    let cancelled = false;
    const leaked: EventListenerOrEventListenerObject[] = [];
    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load Mixcloud's player. An ad blocker or network filter may be blocking it.",
          false,
        );
      }
    }, 8000);

    const host = document.createElement("iframe");
    host.width = "100%";
    host.height = "60";
    host.frameBorder = "0";
    host.allow = "autoplay";
    host.src = widgetSrc(cloudcastKey);
    container.append(host);

    loadApi()
      .then((Mixcloud) => {
        if (cancelled) return;

        const nativeAdd = window.addEventListener;
        window.addEventListener = function (
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: boolean | AddEventListenerOptions,
        ) {
          if (type === "message" && listener) leaked.push(listener);
          nativeAdd.call(window, type, listener, options);
        } as typeof window.addEventListener;

        let widget: MixcloudWidget;
        try {
          widget = Mixcloud.PlayerWidget(host);
        } finally {
          window.addEventListener = nativeAdd;
        }
        widgetRef.current = widget;

        return widget.ready.then(() => {
          if (cancelled) return;
          clearTimeout(blocked);
          readyRef.current = true;

          widget.events.play.on(() => {
            if (!cancelled) handlers.current.handleStateChange("playing");
          });
          widget.events.pause.on(() => {
            if (!cancelled) handlers.current.handleStateChange("paused");
          });
          widget.events.ended.on(() => {
            if (!cancelled) handlers.current.handleEnded();
          });
          widget.events.progress.on((position, duration) => {
            if (!cancelled && duration > 0) handlers.current.handleProgress(position, duration);
          });
          widget.events.error.on(() => {
            if (!cancelled) handlers.current.handleError("Mixcloud couldn't play this one.", true);
          });

          void widget
            .getDuration()
            .then((duration) => {
              if (!cancelled && duration > 0) handlers.current.handleProgress(0, duration);
            })
            .catch(() => undefined);

          void widget
            .play()
            .catch(() => undefined)
            .then(() => widget.getIsPaused())
            .then((paused) => {
              if (!cancelled) handlers.current.handleStateChange(paused ? "paused" : "playing");
            })
            .catch(() => undefined);
        });
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(blocked);
        handlers.current.handleError("Couldn't load Mixcloud's player.", false);
      });

    return () => {
      cancelled = true;
      clearTimeout(blocked);
      widgetRef.current = null;
      readyRef.current = false;
      for (const listener of leaked) window.removeEventListener("message", listener);
      leaked.length = 0;
      container.querySelector("iframe")?.remove();
    };
  }, [cloudcastKey]);

  useEffect(() => {
    registerSeek((seconds) => {
      if (!widgetRef.current || !readyRef.current) return;
      void widgetRef.current.seek(seconds).catch(() => undefined);
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  useEffect(() => {
    registerToggle(() => {
      if (!widgetRef.current || !readyRef.current) return;
      void widgetRef.current.togglePlay().catch(() => undefined);
    });
    return () => registerToggle(null);
  }, [registerToggle]);

  return (
    <div
      className={`flex flex-col gap-2.5 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)] p-3 ${size}`}
    >
      {artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={artworkUrl}
          alt=""
          aria-hidden
          className="min-h-0 w-full flex-1 rounded-[var(--r-sm)] object-cover"
        />
      ) : (
        <div className="min-h-0 flex-1 rounded-[var(--r-sm)] bg-[var(--surface-3)]" />
      )}
      <div
        ref={containerRef}
        className="h-[60px] shrink-0 overflow-hidden rounded-[var(--r-sm)]"
        aria-label="Mixcloud player"
      />
    </div>
  );
}
