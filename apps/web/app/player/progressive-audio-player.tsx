"use client";

import { useEffect, useRef, useState } from "react";

import { useSpeed } from "./playback-speed.ts";
import { usePlayerControls } from "./player-context";
import { useMediaSession } from "./use-media-session";

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
  artworkFallbacks,
  title,
  size = "w-full",
}: {
  /** Built by `stream-url.ts` from the active source and its id. */
  streamUrl: string | null;
  /** Mirrors of the cover, walked in order when one refuses. */
  artworkFallbacks?: string[];
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
  // The lock screen and media keys — only this player can have them; see the hook.
  useMediaSession(audioRef);

  // Audius artwork lives on whichever content node holds the track, and those go down
  // independently — one measured `200`, another `503`, another `502` for the *same* image.
  // The path is content-addressed so any mirror will do; walking them beats a broken frame.
  const covers = [artworkUrl, ...(artworkFallbacks ?? [])].filter(
    (url): url is string => Boolean(url),
  );
  // Held with the cover it belongs to, so a track change resets the walk without an effect —
  // clearing state at the top of one is a synchronous setState and cascades a render.
  const [skipped, setSkipped] = useState<{ key: string; count: number }>({ key: "", count: 0 });
  const coverKey = artworkUrl ?? "";
  const cover = covers[skipped.key === coverKey ? skipped.count : 0] ?? null;

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

  // `defaultPlaybackRate` as well as `playbackRate`: loading a new `src` resets the rate to
  // the default, so setting only the live one lost it on every track change. Pitch is held
  // so 1.25× is the same voice talking faster rather than a higher one. Browsers do that by
  // default already; it is set here because the control is worthless without it.
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

    let cancelled = false;
    audio.play().catch((cause: unknown) => {
      // A `play()` interrupted by a new `src`, a pause or the element going away rejects
      // with `AbortError`. The track changed under it — and by now `songRef` is the *next*
      // song, so reporting this walked that song's ladder for a failure it never had:
      // skipping away from a buffering Audius track switched the YouTube song after it to
      // another copy mid-load, or declared it unplayable.
      if (cancelled || (cause instanceof DOMException && cause.name === "AbortError")) return;
      if (cause instanceof DOMException && cause.name === "NotAllowedError") {
        handlers.current.handleStateChange("paused");
        return;
      }
      handlers.current.handleError("That track wouldn't start.", true);
    });

    return () => {
      cancelled = true;
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
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={cover}
          src={cover}
          alt=""
          aria-hidden
          className="h-full w-full object-cover"
          // Past the last mirror the element is dropped entirely — a black panel is honest,
          // a broken-image glyph is not.
          onError={() =>
            setSkipped((previous) => ({
              key: coverKey,
              count: (previous.key === coverKey ? previous.count : 0) + 1,
            }))
          }
        />
      ) : null}
      <audio ref={audioRef} src={streamUrl ?? undefined} preload="auto" className="sr-only">
        {title ? <track kind="metadata" label={title} /> : null}
      </audio>
    </div>
  );
}
