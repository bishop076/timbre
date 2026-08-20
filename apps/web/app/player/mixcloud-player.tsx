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
  // **`autoplay=1` is the only thing that makes one click enough.** Asking the widget to
  // play over postMessage happens after `ready` resolves, by which point the click that
  // started it is long spent and the browser refuses — so the reader pressed a row, got a
  // paused player, and had to press again. The parameter is read while the frame loads, and
  // the frame is created inside the click, so the page's user activation still covers it.
  //
  // **No `hide_cover`, which helps only before it starts.** Idle, the compact form is a
  // control strip with a subscribe badge and follower counts while the cover form is the
  // artwork with a title and one play circle — so the cover form is the better of the two to
  // look at while a show is loading.
  //
  // **Once playing they are byte-identical**, both showing Mixcloud's own transport: pause,
  // scrubber, listener and favourite counts, beside the artwork. Compared directly at the
  // size Timbre renders it. No parameter removes that, and none should — the embed licence
  // requires the widget stay fully visible with its logo clickable, which is the same bargain
  // the YouTube iframe already makes. A second transport beside Timbre's own is the cost of
  // playing somebody else's audio in their player rather than extracting it.
  return `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(key)}&light=0&autoplay=1`;
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

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cloudcastKey) return;

    let cancelled = false;
    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load Mixcloud's player. An ad blocker or network filter may be blocking it.",
          false,
        );
      }
    }, 8000);

    // **The frame starts loading now, not after the script.** Waiting for `widgetApi.js`
    // before creating the iframe put a whole download in front of the first byte of audio,
    // which is most of why starting a show felt slow. They are independent: the frame can
    // load while the script does, and `PlayerWidget` only has to be called on an iframe that
    // already carries its feed — which is how Mixcloud's own examples do it, and the order an
    // earlier version got backwards, leaving `ready` unresolved and the transport spinning.
    const host = document.createElement("iframe");
    host.width = "100%";
    host.height = "100%";
    host.frameBorder = "0";
    host.allow = "autoplay";
    host.src = widgetSrc(cloudcastKey);
    container.append(host);

    loadApi()
      .then((Mixcloud) => {
        if (cancelled) return;

        const widget = Mixcloud.PlayerWidget(host);
        widgetRef.current = widget;

        return widget.ready.then(() => {
          if (cancelled) return;
          clearTimeout(blocked);
          readyRef.current = true;

          // Every handler checks `cancelled` first. The widget is discarded with its iframe
          // on a show change, but its message listener is not something this API lets us
          // detach — so a late event from the previous show must not be allowed to report a
          // position against the current one's length.
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
          // Exclusives and rights-restricted uploads fail here with no code, exactly like a
          // YouTube upload that refuses to embed. Retryable: the controller can look the same
          // thing up elsewhere.
          widget.events.error.on(() => {
            if (!cancelled) handlers.current.handleError("Mixcloud couldn't play this one.", true);
          });

          // Duration is known at ready and does not need a `progress` tick to arrive, so the
          // bar can show the length immediately rather than `-:-` until the first event.
          void widget
            .getDuration()
            .then((duration) => {
              if (!cancelled && duration > 0) handlers.current.handleProgress(0, duration);
            })
            .catch(() => undefined);

          // **Ask, never assert.** An earlier version reported `paused` here so a refused
          // autoplay would not leave the transport on a spinner. When autoplay *succeeded*
          // that was a lie: the bar showed a play button over a playing track, and pressing
          // it called `togglePlay()` and stopped the music. Reported symptom, and exactly
          // this line. The widget knows which it is, so it is asked.
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
      container.querySelector("iframe")?.remove();
    };
    // **Keyed on the show, so each one gets its own widget and its own teardown.** The
    // SoundCloud widget takes a new track through `load()`; Mixcloud's takes the feed in the
    // iframe URL, and re-pointing `src` under a live widget leaves the old instance bound and
    // still emitting. Two sets of `progress` events then interleave and the transport reports
    // one show's position against another's length — reported as "it lags when I switch",
    // and visible as a bar reading 22:59 / 74:57 beside a widget showing 1:02:10.
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
