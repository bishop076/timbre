"use client";

import { useEffect, useRef, useState } from "react";

import { proxied } from "../artwork-url";
import { log } from "../logs.ts";
import { useLatest, useTransport } from "./embed";
import { useSpeed } from "./playback-speed.ts";
import { usePlayerControls } from "./player-context";
import { stalledStart, startedPlaying, START_DEADLINE_MS } from "./progressive-stall.ts";
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

  // Every other cover in the app draws through `<Artwork>`, which proxies. This one used
  // the raw URL, so a cover on a host `/api/art` does not serve was fetched by the browser
  // straight from that host. `proxied` keeps the allowlisted ones on our origin.
  const covers = [artworkUrl, ...(artworkFallbacks ?? [])]
    .map((url) => proxied(url))
    .filter((url): url is string => Boolean(url));
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

    // Asked of the url being *tried*, not of the one the song shipped with. `src === streamUrl`
    // is true only on the first attempt, so the walk stopped dead after one hop: the second and
    // third fallbacks `nextStreamHost` exists to reach were never asked for, and a track whose
    // first two Audius nodes were down gave up with two of its four addresses untried.
    const fallback = nextStreamHost(src);
    let started = false;

    // A media resource that fails to load fires the element's `error` event *and* rejects the
    // pending `play()` with `NotSupportedError`. The only guard against reporting both was the
    // `fallback &&` test below, which holds solely while a second host is left to try — never
    // for archive.org (`stream-url.ts` returns no fallback for it) and never for the last
    // Audius host. The second report walked the ladder a second time: walk #1 called
    // `start(soundcloud)`, walk #2 found soundcloud already in `spent` and jumped past it,
    // which can reach `adoptElsewhere` → `addSourcesToSong` and permanently rewrite the song's
    // sources inside saved playlists, off one failure counted twice. One load, one verdict.
    let reported = false;
    const report = (message: string) => {
      if (reported) return;
      reported = true;
      live.current.handleError(message, true);
    };

    // The same two answers the `error` handler gives, on the same one-verdict guard — reached
    // by a clock instead of an event, because the failure this catches fires no event at all.
    const takeFallback = () => {
      if (reported || !fallback) return false;
      reported = true;
      setRetry({ key: streamUrl, url: fallback });
      return true;
    };

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
    // `play` fires when `play()` is *called*, which is not the same claim as "this is playing"
    // — see `startedPlaying`. `playing` is the event that means audio, and it fires on a resume
    // as well as on a first start, so nothing is lost by waiting for it.
    on("play", () => {
      if (startedPlaying(audio)) live.current.handleStateChange("playing");
    });
    on("playing", () => {
      started = true;
      live.current.handleStateChange("playing");
    });
    on("pause", () => live.current.handleStateChange("paused"));
    on("ended", () => live.current.handleEnded());
    on("error", () => {
      // Taking the fallback is a verdict too, as far as the pending `play()` is concerned.
      if (started || !takeFallback()) report("That track wouldn't play.");
    });

    const deadline = setTimeout(() => {
      if (started || !stalledStart(audio)) return;
      if (!takeFallback()) report("That track never started playing.");
    }, START_DEADLINE_MS);

    audio.play().catch((cause: unknown) => {
      const name = cause instanceof DOMException ? cause.name : "";
      if (lifetime.signal.aborted || name === "AbortError") return;
      if (fallback && name === "NotSupportedError") return;
      if (name === "NotAllowedError") {
        // The one refusal a player can name outright, and it was the one nobody heard: this
        // reported a plain "paused" and the reason went nowhere. The state still has to be a
        // pause — the element *is* paused, and calling it an error would walk the ladder onto
        // sources the same policy will refuse — but the log should say what happened, because
        // "the queue stops between songs" reads identically to every other stall without it.
        log("warn", "The browser refused to start this track on its own — autoplay is blocked here.");
        live.current.handleStateChange("paused");
      } else report("That track wouldn't start.");
    });

    return () => {
      clearTimeout(deadline);
      lifetime.abort();
    };
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
          // Fit, not fill, and never upscaled. `object-cover` stretched a 500px cover to fill
          // whatever the panel had grown to, which is where the blur came from — an image
          // enlarged past its own pixels cannot be sharp. max-* with no width/height lets it
          // render at its natural size and only shrink when the box is smaller than the art.
          className="max-h-full max-w-full object-contain"
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
