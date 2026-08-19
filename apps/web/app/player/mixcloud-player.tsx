"use client";

import { useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

// The Mixcloud Widget, embedded unmodified. Closest in shape to `soundcloud-player.tsx` —
// an iframe plus a script that adopts it — and it carries the same two constraints: the
// widget must stay **fully visible** and its logo must stay clickable through to
// mixcloud.com, because the embed licence is explicitly personal and non-commercial. That is
// the same bargain the YouTube iframe already makes, so it costs nothing here.
//
// Unlike SoundCloud's, this API is promise-based: `Mixcloud.PlayerWidget(iframe)` returns
// immediately and `widget.ready` resolves once the frame has handshaken. Events arrive on
// `widget.events.*` with `.on(handler)`, and `progress` reports both position and duration,
// so nothing has to be polled.

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

  return apiPromise;
}

/** Mirrors `mixcloudWidgetUrl` in `packages/providers/src/mixcloud.ts` — a client component
 * must not import a server-only package, see `app/types.ts`. */
function widgetSrc(key: string): string {
  return `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(key)}&hide_cover=1&light=0`;
}

export function MixcloudPlayer({
  cloudcastKey,
  size = "w-full",
}: {
  cloudcastKey: string | null;
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
  const loadedKey = useRef<string | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || widgetRef.current || !cloudcastKey) return;

    let cancelled = false;
    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load Mixcloud's player. An ad blocker or network filter may be blocking it.",
          false,
        );
      }
    }, 8000);

    // **Script first, then the frame.** Creating the iframe before the API has loaded means
    // the widget completes its handshake with nothing listening, and `ready` then never
    // resolves — the transport sits on a spinner over a player that is perfectly fine.
    // `PlayerWidget` installs the message listener, so it has to exist before the frame does.
    loadApi()
      .then((Mixcloud) => {
        if (cancelled) return;

        const host = document.createElement("iframe");
        host.width = "100%";
        host.height = "180";
        host.frameBorder = "0";
        host.allow = "autoplay";
        loadedKey.current = cloudcastKey;
        container.append(host);

        const widget = Mixcloud.PlayerWidget(host);
        widgetRef.current = widget;
        // Set last: the listener is attached, so the handshake cannot outrun it.
        host.src = widgetSrc(cloudcastKey);

        return widget.ready.then(() => {
          if (cancelled) return;
          clearTimeout(blocked);
          readyRef.current = true;

          widget.events.play.on(() => handlers.current.handleStateChange("playing"));
          widget.events.pause.on(() => handlers.current.handleStateChange("paused"));
          widget.events.ended.on(() => handlers.current.handleEnded());
          widget.events.progress.on((position, duration) => {
            if (duration > 0) handlers.current.handleProgress(position, duration);
          });
          // Exclusives and rights-restricted uploads fail here with no code, exactly like a
          // YouTube upload that refuses to embed. Retryable: the controller can look the same
          // thing up elsewhere.
          widget.events.error.on(() =>
            handlers.current.handleError("Mixcloud couldn't play this one.", true),
          );

          // **Ready means playable, so say so before trying to play.** The widget reports
          // `play` only once audio actually starts, and a browser that refuses autoplay
          // never gets there — leaving the transport on a spinner with a perfectly good
          // player sitting under it. Settling to `paused` first means the worst case is a
          // player waiting to be pressed, which is true, rather than one that looks broken.
          handlers.current.handleStateChange("paused");

          // Duration is known at ready and does not need a `progress` tick to arrive, so the
          // bar can show the length immediately rather than `-:-` until the first event.
          void widget
            .getDuration()
            .then((duration) => {
              if (!cancelled && duration > 0) handlers.current.handleProgress(0, duration);
            })
            .catch(() => undefined);

          void widget.play().catch(() => {
            // A refused autoplay is a paused player, not a failure — and it is already
            // paused, so there is nothing further to say.
          });
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
      container.querySelector("iframe")?.remove();
    };
    // Seeds the iframe's initial src only; a change is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different show means a different feed, and the widget takes it in the URL rather than
  // through a load() call, so the frame is re-pointed.
  useEffect(() => {
    if (!cloudcastKey) return;
    if (loadedKey.current === cloudcastKey) return;
    const frame = containerRef.current?.querySelector("iframe");
    if (!frame) return;
    loadedKey.current = cloudcastKey;
    readyRef.current = false;
    frame.src = widgetSrc(cloudcastKey);
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
      ref={containerRef}
      className={`overflow-hidden bg-black ${size}`}
      aria-label="Mixcloud player"
    />
  );
}
