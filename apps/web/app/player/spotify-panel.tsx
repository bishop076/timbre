"use client";

import { useEffect, useState } from "react";

import { accessToken } from "../spotify/connection.ts";
import { SPOTIFY_REFUSAL } from "../spotify/failures.ts";
import { useSpotifyTokens } from "../spotify/token-store.ts";
import type { Song } from "../types";

type Availability = "unknown" | "playable" | "region-restricted";

/**
 * Whether this account's market will serve the track at all.
 *
 * `market=from_token` makes Spotify answer for the connected account rather than for the world,
 * and `is_playable` is how it says no. Worth one small request: a track Spotify has licensed
 * nowhere near you fails at the player with no explanation whatsoever, and "not licensed in your
 * country" is a thing a reader can act on — by playing another copy from another source — where
 * an embed that silently refuses is just Timbre looking broken.
 */
async function availability(trackId: string, signal: AbortSignal): Promise<Availability> {
  const token = await accessToken();
  if (!token) return "unknown";

  const response = await fetch(
    `https://api.spotify.com/v1/tracks/${encodeURIComponent(trackId)}?market=from_token`,
    { headers: { authorization: `Bearer ${token}` }, signal },
  );
  if (!response.ok) return "unknown";

  const track = (await response.json()) as { is_playable?: boolean };
  return track.is_playable === false ? "region-restricted" : "playable";
}

export function SpotifyPanel({ song }: { song: Song | null }) {
  const connected = Boolean(useSpotifyTokens());
  const [found, setFound] = useState<{ key: string; trackId: string | null } | null>(null);
  const [market, setMarket] = useState<{ trackId: string; state: Availability } | null>(null);
  const alreadySpotify = song?.sources.some((source) => source.source === "spotify") ?? false;
  const key = song?.id ?? null;

  useEffect(() => {
    if (!song || !key || alreadySpotify || (!song.album && !song.isrc)) return;

    const aborter = new AbortController();
    const params = new URLSearchParams({ title: song.title });
    if (song.artists[0]) params.set("artist", song.artists[0]);
    if (song.album) params.set("album", song.album);
    if (song.isrc) params.set("isrc", song.isrc);

    fetch(`/api/spotify?${params}`, { signal: aborter.signal })
      .then((response) => (response.ok ? (response.json() as Promise<{ trackId: string | null }>) : null))
      .then((data) => setFound({ key, trackId: data?.trackId ?? null }))
      .catch(() => {});

    return () => aborter.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, alreadySpotify]);

  const trackId = found?.key === key ? found.trackId : null;

  useEffect(() => {
    if (!trackId || !connected) return;

    const aborter = new AbortController();
    availability(trackId, aborter.signal)
      .then((state) => setMarket({ trackId, state }))
      .catch(() => {});

    return () => aborter.abort();
  }, [trackId, connected]);

  if (!trackId) return null;

  const restricted = market?.trackId === trackId && market.state === "region-restricted";
  const refusal = SPOTIFY_REFUSAL["region-restricted"];

  return (
    <section className="overflow-hidden rounded-[var(--r-lg)] bg-[var(--surface-2)]">
      <h3 className="px-4 pb-2 pt-3 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
        Also on Spotify
      </h3>

      {restricted ? (
        <div className="px-4 pb-4">
          <p className="text-[13px] font-bold text-[var(--warn)]">{refusal.title}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--fg-dim)]">{refusal.detail}</p>
        </div>
      ) : (
        <>
          <iframe
            src={`https://open.spotify.com/embed/track/${encodeURIComponent(trackId)}?theme=0`}
            title="Spotify player"
            width="100%"
            height="152"
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            className="block border-0"
          />
          {/*
            One line, not a paragraph. The full story is: this is Spotify's own embed, what it
            serves depends on whether it can see an open.spotify.com login of its own (which most
            browsers now hide from a frame inside another site), and full playback in Timbre's
            player is the separate Premium-only SDK path. All true, and all of it was sitting
            under a 152px box as three lines of small print explaining a thing before it had gone
            wrong. The short version covers the only case a reader needs warning about — a stop at
            30 seconds that would otherwise look like a fault — and the rest lives here.
          */}
          <p className="px-4 pb-3 pt-2 text-[length:var(--text-meta)] text-[var(--fg-faint)]">
            Spotify&rsquo;s embed. Stops at 30&nbsp;seconds unless it can see your Spotify login.
          </p>
        </>
      )}
    </section>
  );
}
