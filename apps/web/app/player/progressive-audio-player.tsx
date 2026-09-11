"use client";

import { useEffect, useRef, useState } from "react";

import { useLatest, useTransport } from "./embed";
import { useSpeed } from "./playback-speed.ts";
import { usePlayerControls } from "./player-context";
import { nextStreamHost } from "./stream-url";
import { useMediaSession } from "./use-media-session";

export function ProgressiveAudioPlayer({
  streamUrl,
  artworkUrl,
  artworkFallbacks,
  title,
  size = "w-full",
}: {
  streamUrl: string | null;
  artworkFallbacks?: string[];
  artworkUrl?: string | null;
  title?: string;
  size?: string;
}) {
  const controls = usePlayerControls();
  const level = controls.muted ? 0 : controls.volume;
  const live = useLatest(controls);
  const audioRef = useRef<HTMLAudioElement>(null);
  useMediaSession(audioRef);

  const covers = [artworkUrl, ...(artworkFallbacks ?? [])].filter(
    (url): url is string => Boolean(url),
  );
  const [skipped, setSkipped] = useState<{ key: string; count: number }>({ key: "", count: 0 });
  const coverKey = artworkUrl ?? "";
  const cover = covers[skipped.key === coverKey ? skipped.count : 0] ?? null;

  const [retry, setRetry] = useState<{ key: string; url: string } | null>(null);
  const src = retry && retry.key === streamUrl ? retry.url : streamUrl;

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, level / 100));
  }, [level]);

  const speed = useSpeed();
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.preservesPitch = true;
    audio.defaultPlaybackRate = speed;
    audio.playbackRate = speed;
  }, [speed, streamUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl || !src) return;

    const fallback = src === streamUrl ? nextStreamHost(src) : null;
    let started = false;

    const lifetime = new AbortController();
    const on = (type: string, listener: () => void) =>
      audio.addEventListener(type, listener, { signal: lifetime.signal });
    const onTime = () => {
      if (Number.isFinite(audio.duration)) {
        live.current.handleProgress(audio.currentTime, audio.duration);
      }
    };
    on("timeupdate", onTime);
    on("durationchange", onTime);
    on("play", () => live.current.handleStateChange("playing"));
    on("playing", () => {
      started = true;
    });
    on("pause", () => live.current.handleStateChange("paused"));
    on("ended", () => live.current.handleEnded());
    on("error", () => {
      if (fallback && !started) setRetry({ key: streamUrl, url: fallback });
      else live.current.handleError("That track wouldn't play.", true);
    });

    audio.play().catch((cause: unknown) => {
      const name = cause instanceof DOMException ? cause.name : "";
      if (lifetime.signal.aborted || name === "AbortError") return;
      if (fallback && name === "NotSupportedError") return;
      if (name === "NotAllowedError") live.current.handleStateChange("paused");
      else live.current.handleError("That track wouldn't start.", true);
    });

    return () => lifetime.abort();
  }, [live, src, streamUrl]);

  useTransport({
    toggle: () => {
      const audio = audioRef.current;
      if (audio?.paused) void audio.play().catch(() => undefined);
      else audio?.pause();
    },
    seek: (seconds) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.min(Math.max(0, seconds), audio.duration);
    },
  });

  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden bg-black ${size}`}
      aria-label="Audio player"
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={cover}
          src={cover}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          onError={() =>
            setSkipped((previous) => ({
              key: coverKey,
              count: (previous.key === coverKey ? previous.count : 0) + 1,
            }))
          }
        />
      ) : null}
      <audio ref={audioRef} src={src ?? undefined} preload="auto" className="sr-only">
        {title ? <track kind="metadata" label={title} /> : null}
      </audio>
    </div>
  );
}
