"use client";

import { useEffect, useState } from "react";

import type { Song } from "../types";

// "Also on Spotify" — a separate, attributed panel, and never anything else.
//
// This is the shape `PLAN.md` described from the start: *see where else a song lives, and
// hand off.* Developer Terms §IV.2 forbid integrating Spotify's streams with another
// service's, so this can be a panel the reader presses and cannot be a queue member — and it
// happens that the embed exposes no play API either, so the rule and the surface agree.
//
// The id comes from MetaBrainz's resolver rather than Spotify, which is why this exists at
// all: no key, no account, no developer app. See `docs/SEARCH-ROUTES.md` R9.
//
// Silence is the common case and is not an error. Most songs will not resolve — the chain is
// measured around 10/15 — and the panel simply does not render. Nothing is announced, because
// "not on Spotify" is not news.

const EMBED = "https://open.spotify.com/embed";

export function SpotifyPanel({ song }: { song: Song | null }) {
  // Stored with the song it belongs to, the way `related-panel.tsx` stores its seed: clearing
  // state at the top of the effect is a synchronous setState and cascades a render, while
  // comparing keys at paint costs nothing and cannot show the previous song's embed.
  const [found, setFound] = useState<{ key: string; trackId: string | null } | null>(null);

  // Already a Spotify song — it arrived by pasted link and the player is showing it. A second
  // copy of the same embed under the first would be absurd.
  const alreadySpotify = song?.sources.some((source) => source.source === "spotify") ?? false;

  const key = song ? `${song.id}` : null;

  useEffect(() => {
    if (!song || !key || alreadySpotify) return;
    // Neither route can answer without one of these, and the endpoint would only tell us so
    // after a round trip.
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
        // Abstain. The dataset host is not SLA'd, and a missing panel is the same outcome as
        // a song that is not on Spotify — which is what the reader would infer anyway.
      });

    return () => aborter.abort();
    // Keyed on the song, not the object: the queue hands out fresh ones on every edit.
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
