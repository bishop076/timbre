"use client";

import { useEffect, useRef, useState } from "react";

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

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, (muted ? 0 : volume) / 100));
  }, [volume, muted]);

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

    const onTime = () => {
      if (Number.isFinite(audio.duration)) handlers.current.handleProgress(audio.currentTime, audio.duration);
    };
    const onPlay = () => handlers.current.handleStateChange("playing");
    const onPlaying = () => {
      started = true;
    };
    const onPause = () => handlers.current.handleStateChange("paused");
    const onEnded = () => handlers.current.handleEnded();
    const onError = () => {
      if (fallback && !started) {
        setRetry({ key: streamUrl, url: fallback });
        return;
      }
      handlers.current.handleError("That track wouldn't play.", true);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    let cancelled = false;
    audio.play().catch((cause: unknown) => {
      if (cancelled || (cause instanceof DOMException && cause.name === "AbortError")) return;
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        handlers.current.handleStateChange("paused");
        return;
      }
      if (fallback && cause instanceof DOMException && cause.name === "NotSupportedError") return;
      handlers.current.handleError("That track wouldn't start.", true);
    });

    return () => {
      cancelled = true;
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [src, streamUrl]);

  useEffect(() => {
    registerSeek((seconds) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(audio.duration)) return;
      audio.currentTime = Math.min(Math.max(0, seconds), audio.duration);
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  useEffect(() => {
    registerToggle(() => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) void audio.play().catch(() => undefined);
      else audio.pause();
    });
    return () => registerToggle(null);
  }, [registerToggle]);

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
