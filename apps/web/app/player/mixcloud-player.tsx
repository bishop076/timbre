"use client";

import { useEffect, useRef } from "react";

import { hideWhenBroken } from "../artwork";
import { proxied } from "../artwork-url";
import { blockedTimer, loadGlobal, useLatest, useTransport } from "./embed";
import { usePlayerControls } from "./player-context";

interface MixcloudEvent<T extends unknown[] = []> {
  on(handler: (...args: T) => void): void;
}

interface MixcloudWidget {
  ready: Promise<void>;
  play(): Promise<void>;
  togglePlay(): Promise<void>;
  seek(seconds: number): Promise<boolean>;
  getDuration(): Promise<number>;
  getIsPaused(): Promise<boolean>;
  events: {
    play: MixcloudEvent;
    pause: MixcloudEvent;
    ended: MixcloudEvent;
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

const loadApi = loadGlobal(API_SRC, () => window.Mixcloud);

export function MixcloudPlayer({
  cloudcastKey,
  artworkUrl,
  size = "w-full",
}: {
  cloudcastKey: string | null;
  artworkUrl?: string | null;
  size?: string;
}) {
  const live = useLatest(usePlayerControls());

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<MixcloudWidget | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !cloudcastKey) return;

    let cancelled = false;
    const alive = () => (cancelled ? null : live.current);
    const leaked: EventListenerOrEventListenerObject[] = [];
    // Mixcloud not loading says nothing about the sources under it, so the ladder keeps walking —
    // `spent` already holds "mixcloud", and it is not a rung, so this cannot come back round.
    const clearBlocked = blockedTimer("Mixcloud", (reason) =>
      live.current.handleError(reason, true),
    );

    const host = Object.assign(document.createElement("iframe"), {
      width: "100%",
      height: "60",
      frameBorder: "0",
      allow: "autoplay",
      src: `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(cloudcastKey)}&mini=1&light=0&autoplay=1`,
    });
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

        return widget.ready.then(() => {
          if (cancelled) return;
          clearBlocked();
          widgetRef.current = widget;

          const { events } = widget;
          events.play.on(() => alive()?.handleStateChange("playing"));
          events.pause.on(() => alive()?.handleStateChange("paused"));
          events.ended.on(() => alive()?.handleEnded());
          events.progress.on((position, duration) => {
            if (duration > 0) alive()?.handleProgress(position, duration);
          });
          events.error.on(() => alive()?.handleError("Mixcloud couldn't play this one.", true));

          void widget
            .getDuration()
            .then((duration) => {
              if (duration > 0) alive()?.handleProgress(0, duration);
            })
            .catch(() => undefined);

          void widget
            .play()
            .catch(() => undefined)
            .then(() => widget.getIsPaused())
            .then((paused) => alive()?.handleStateChange(paused ? "paused" : "playing"))
            .catch(() => undefined);
        });
      })
      .catch(() => {
        if (cancelled) return;
        clearBlocked();
        live.current.handleError("Couldn't load Mixcloud's player.", true);
      });

    return () => {
      cancelled = true;
      clearBlocked();
      widgetRef.current = null;
      for (const listener of leaked) window.removeEventListener("message", listener);
      container.querySelector("iframe")?.remove();
    };
  }, [cloudcastKey, live]);

  useTransport({
    toggle: () => void widgetRef.current?.togglePlay().catch(() => undefined),
    seek: (seconds) => void widgetRef.current?.seek(seconds).catch(() => undefined),
  });

  return (
    <div
      className={`flex flex-col gap-2.5 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)] p-3 ${size}`}
    >
      {artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proxied(artworkUrl) ?? undefined}
          alt=""
          aria-hidden
          {...hideWhenBroken}
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
