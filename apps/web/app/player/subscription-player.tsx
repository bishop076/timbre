"use client";

import { useTransport } from "./embed";

const EMBEDS = {
  apple: {
    label: "Apple Music player",
    height: 175,
    base: "https://embed.music.apple.com/us/song",
  },
  deezer: {
    label: "Deezer player",
    height: 300,
    base: "https://widget.deezer.com/widget/dark/track",
  },
};

export function SubscriptionPlayer({
  track,
  size = "w-full",
}: {
  track: { source: keyof typeof EMBEDS; id: string } | null;
  size?: string;
}) {
  useTransport(null);

  if (!track) return null;
  const embed = EMBEDS[track.source];

  return (
    <div className={`flex items-center justify-center overflow-hidden bg-black ${size}`}>
      <iframe
        src={`${embed.base}/${encodeURIComponent(track.id)}`}
        title={embed.label}
        width="100%"
        height={embed.height}
        frameBorder="0"
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
    </div>
  );
}
