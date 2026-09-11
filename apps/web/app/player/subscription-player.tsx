"use client";

import { useEffect } from "react";

import { usePlayerControls } from "./player-context";

const APPLE_STOREFRONT = "us";

function embedUrlFor(source: "apple" | "deezer", id: string): string {
  const safe = encodeURIComponent(id);
  return source === "apple"
    ? `https://embed.music.apple.com/${APPLE_STOREFRONT}/song/${safe}`
    : `https://widget.deezer.com/widget/dark/track/${safe}`;
}

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
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
    </div>
  );
}
