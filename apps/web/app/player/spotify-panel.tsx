"use client";

import { useEffect, useState } from "react";

import type { Song } from "../types";

const EMBED = "https://open.spotify.com/embed";

export function SpotifyPanel({ song }: { song: Song | null }) {
  const [found, setFound] = useState<{ key: string; trackId: string | null } | null>(null);

  const alreadySpotify = song?.sources.some((source) => source.source === "spotify") ?? false;

  const key = song ? `${song.id}` : null;

  useEffect(() => {
    if (!song || !key || alreadySpotify) return;
    if (!song.album && !song.isrc) return;

    const aborter = new AbortController();
    const params = new URLSearchParams({ title: song.title });
    if (song.artists[0]) params.set("artist", song.artists[0]);
    if (song.album) params.set("album", song.album);
    if (song.isrc) params.set("isrc", song.isrc);

    fetch(`/api/spotify?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ trackId: string | null }>) : null))
      .then((data) => setFound({ key, trackId: data?.trackId ?? null }))
      .catch(() => {
      });

    return () => aborter.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, alreadySpotify]);

  const trackId = found?.key === key ? found.trackId : null;
  if (!trackId) return null;

  return (
    <section className="slab-sm overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)]">
      <h3 className="px-3 pb-1.5 pt-2.5 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
        Also on Spotify
      </h3>
      <iframe
        src={`${EMBED}/track/${encodeURIComponent(trackId)}?theme=0`}
        title="Spotify player"
        width="100%"
        height="152"
        frameBorder="0"
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      />
      <p className="px-3 pb-2.5 pt-1 text-[11px] text-[var(--fg-faint)]">
        Plays in Spotify&rsquo;s own player. Signed in, you hear the whole track; otherwise a
        preview.
      </p>
    </section>
  );
}
