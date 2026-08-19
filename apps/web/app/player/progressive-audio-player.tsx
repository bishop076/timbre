"use client";

import { useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

// The player Timbre owns. YouTube and SoundCloud hand back an iframe and an API to poke at
// it; Audius and the Internet Archive hand back audio, so this is an ordinary `<audio>`
// element and most of the paranoia in the other two files simply does not apply — no script
// to load, no ad blocker to survive, no polling, because a media element emits real events.
//
// One component for both, and for whatever comes next: the differences between progressive
// sources are entirely in the URL, which is `stream-url.ts`'s job. Nothing below this line
// knows which service it is playing.
//
// Three things here are deliberate.
//
// **A redirect is followed, not resolved ahead of time.** Audius's `/stream` answers 302 to
// a *signed* URL carrying a timestamp; pointing the element at the redirect resolves it at
// the moment of playback, so a link cannot go stale between search and play.
//
// **`crossOrigin` is never set.** A media element may load cross-origin without CORS; asking
// for it would *require* the content node to send `Access-Control-Allow-Origin`, which is an
// operator-run host that need not. Setting it would only be necessary to read the samples —
// WebAudio, canvas — which Timbre does not do.
//
// **A refused autoplay is a paused player, not an error.** Playback normally starts from a
// click so the gesture is already spent, but a queue that auto-advances after a long pause
// can lose it. Reporting that as a failure would send the controller hunting for another
// copy of a song that is fine.

export function ProgressiveAudioPlayer({
  streamUrl,
  artworkUrl,
  title,
  size = "w-full",
}: {
  /** Built by `stream-url.ts` from the active source and its id. */
  streamUrl: string | null;
  artworkUrl?: string | null;
  title?: string;
  /** Sizing only, so the player area does not collapse when the source has no video. */
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

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  // 0–100 here, 0–1 on the element.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = Math.min(1, Math.max(0, (muted ? 0 : volume) / 100));
  }, [volume, muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;

    const onTime = () => {
      // `duration` is NaN until metadata lands, and a NaN progress bar renders as a full one.
      if (Number.isFinite(audio.duration)) handlers.current.handleProgress(audio.currentTime, audio.duration);
    };
    const onPlay = () => handlers.current.handleStateChange("playing");
    const onPause = () => handlers.current.handleStateChange("paused");
    const onEnded = () => handlers.current.handleEnded();
    const onError = () => {
      // Gated, withdrawn and region-locked uploads all arrive here indistinguishably — the
      // element reports a code, never a reason. Worth retrying: unlike SoundCloud there *is*
      // somewhere to go, since the controller can look the same song up on YouTube Music.
      handlers.current.handleError("That track wouldn't play.", true);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onTime);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    audio.play().catch((cause: unknown) => {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        handlers.current.handleStateChange("paused");
        return;
      }
      handlers.current.handleError("That track wouldn't start.", true);
    });

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onTime);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, [streamUrl]);

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
      {/* The player area is sized for YouTube's 200×200 minimum and is a hole without a
          video in it, so the cover fills it. Not proxied: Audius artwork is served by the
          same operator-run content nodes as the audio — see `app/artwork-url.ts`. */}
      {artworkUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={artworkUrl} alt="" aria-hidden className="h-full w-full object-cover" />
      ) : null}
      <audio ref={audioRef} src={streamUrl ?? undefined} preload="auto" className="sr-only">
        {title ? <track kind="metadata" label={title} /> : null}
      </audio>
    </div>
  );
}
