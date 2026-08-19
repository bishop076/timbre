"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";

// Spotify's own embed, and the only player here Timbre cannot drive.
//
// There is no API on it — no play, no pause, no position, no ended event. That is the whole
// surface Spotify offers without a developer app, and it is also what keeps this clear of
// Developer Terms §IV.2: a panel the reader starts is not a queue blending their audio with
// another service's. So this component registers *nothing* with the controller. The
// transport buttons stay inert while it is showing, and the queue stops here rather than
// advancing past a track nobody heard — a song someone deliberately queued should not
// vanish without explanation.
//
// A free Spotify account is enough to hear the whole track; without one it is the 30-second
// preview Spotify chooses to serve. Either way the play is theirs, counted and paid as it
// would be on Spotify itself.

const EMBED = "https://open.spotify.com/embed";

/** Mirrors `spotifyEmbedUrl` in `packages/providers/src/spotify.ts`; a client component must
 * not import a server-only package — see `app/types.ts`. */
function embedUrlFor(trackId: string): string {
  return `${EMBED}/track/${encodeURIComponent(trackId)}`;
}

export function SpotifyPlayer({
  trackId,
  size = "w-full",
}: {
  trackId: string | null;
  size?: string;
}) {
  const { registerToggle, registerSeek } = usePlayerControls();

  // Explicitly deregistered rather than left alone: whatever played before this registered a
  // toggle and a seek, and those close over a torn-down player. Pressing space would
  // otherwise reach a dead handler while a Spotify panel is on screen.
  useEffect(() => {
    registerToggle(null);
    registerSeek(null);
    return () => {
      registerToggle(null);
      registerSeek(null);
    };
  }, [registerToggle, registerSeek]);

  if (!trackId) return null;

  return (
    <div className={`flex items-center justify-center overflow-hidden bg-black ${size}`}>
      <iframe
        // `?theme=0` is the dark variant; Spotify picks light otherwise and it glares.
        src={`${embedUrlFor(trackId)}?theme=0`}
        title="Spotify player"
        width="100%"
        height="152"
        frameBorder="0"
        loading="lazy"
        // Spotify's own oEmbed markup asks for exactly these.
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
    </div>
  );
}
