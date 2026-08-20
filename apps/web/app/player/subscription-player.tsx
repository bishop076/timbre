"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";

/**
 * Apple Music's and Deezer's own embeds — the two players that give a **subscriber the whole
 * song** rather than the clip their catalogues publish.
 *
 * `apple.ts` and `deezer.ts` are `link` sources: Timbre plays each one's `previewUrl`, a
 * static thirty-second file, in its own `<audio>`. That file is the right floor for the
 * fall-through ladder — it starts by script and advances the queue — but nothing about it
 * can ever be longer than thirty seconds, and no amount of being signed in changes that,
 * because the request never reaches the service as a session.
 *
 * Their embeds do. Apple's marketing-tools documentation states it plainly: a listener not
 * signed in hears a thirty-second clip, and a signed-in Apple Music subscriber hears full
 * tracks without leaving the page. The embed carries its own **Sign In** button.
 *
 * Measured 2026-08-20, in a real browser:
 *
 * - `embed.music.apple.com/us/song/{id}` — renders a working player. No `X-Frame-Options`,
 *   and its CSP carries no `frame-ancestors`. Shadow DOM holds the title, artist, *Play*,
 *   *Sign In* and *View in Apple Music*.
 * - `widget.deezer.com/widget/dark/track/{id}` — renders title, artist, *Play* and a link
 *   back to deezer.com. **Use the bare path**: adding query parameters returned an empty
 *   widget in the same test.
 *
 * **This registers nothing with the controller, exactly like `spotify-player.tsx`.** Neither
 * embed exposes a play API, so nothing here can start one, hear it end, or read its
 * position. The transport stays inert while a panel is showing and the queue rests on this
 * entry rather than advancing past a song nobody heard. That is also what keeps it the same
 * shape as the Spotify panel the terms were already reasoned about: a player the reader
 * presses, not audio blended into a queue.
 */

/** Apple's default storefront, mirroring `config.country ?? "us"` in
 * `packages/providers/src/apple.ts` — the store the ids come from. A client component must
 * not import a server-only package, so this is duplicated rather than shared; see
 * `app/types.ts`, and `spotify-player.tsx` for the same duplication and the same reason. */
const APPLE_STOREFRONT = "us";

function embedUrlFor(source: "apple" | "deezer", id: string): string {
  const safe = encodeURIComponent(id);
  return source === "apple"
    ? `https://embed.music.apple.com/${APPLE_STOREFRONT}/song/${safe}`
    : `https://widget.deezer.com/widget/dark/track/${safe}`;
}

/** Each service's own player is a different height, and cropping one hides its controls. */
const HEIGHT: Record<"apple" | "deezer", number> = { apple: 175, deezer: 300 };

const LABEL: Record<"apple" | "deezer", string> = {
  apple: "Apple Music player",
  deezer: "Deezer player",
};

export function SubscriptionPlayer({
  track,
  size = "w-full",
}: {
  track: { source: "apple" | "deezer"; id: string } | null;
  size?: string;
}) {
  const { registerToggle, registerSeek } = usePlayerControls();

  // Deregistered rather than left alone, for the reason `spotify-player.tsx` gives: whatever
  // played before this registered a toggle and a seek closing over a player that is now torn
  // down, and pressing space would reach a dead handler.
  useEffect(() => {
    registerToggle(null);
    registerSeek(null);
    return () => {
      registerToggle(null);
      registerSeek(null);
    };
  }, [registerToggle, registerSeek]);

  if (!track) return null;

  return (
    <div className={`flex items-center justify-center overflow-hidden bg-black ${size}`}>
      <iframe
        src={embedUrlFor(track.source, track.id)}
        title={LABEL[track.source]}
        width="100%"
        height={HEIGHT[track.source]}
        frameBorder="0"
        loading="lazy"
        // What both services' own embed markup asks for. `encrypted-media` is the one that
        // matters: full-length playback for a subscriber is DRM-protected.
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
    </div>
  );
}
