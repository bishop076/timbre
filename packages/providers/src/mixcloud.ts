import type { SearchContext, SearchProvider, SourceTrack } from "./types.ts";
import { cachePolicy } from "./cache-policy.ts";
import { createRequester } from "./request.ts";

const API = "https://api.mixcloud.com";
const WEB = "https://www.mixcloud.com";

interface MixcloudPicture {
  "320wx320h"?: string;
  "640wx640h"?: string;
  large?: string;
}

interface MixcloudCloudcast {
  key?: string;
  name?: string;
  audio_length?: number;
  user?: { name?: string; username?: string };
  pictures?: MixcloudPicture | null;
}

function toSourceTrack(raw: MixcloudCloudcast): SourceTrack | null {
  if (!raw.key || !raw.name) return null;

  const host = raw.user?.name?.trim() || raw.user?.username?.trim();

  return {
    source: "mixcloud",
    sourceId: raw.key,
    title: raw.name.trim(),
    artists: host ? [host] : [],
    album: null,
    durationMs: raw.audio_length ? raw.audio_length * 1000 : null,
    isrc: null,
    url: `${WEB}${raw.key}`,
    artworkUrl: raw.pictures?.["640wx640h"] ?? raw.pictures?.["320wx320h"] ?? raw.pictures?.large ?? null,
    playback: "queue",
  };
}

const request = createRequester({
  id: "mixcloud",
  label: "Mixcloud",
  init: cachePolicy,
});

export function mixcloudWidgetUrl(key: string): string {
  return `https://player-widget.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(key)}&hide_cover=1&light=0&autoplay=1`;
}

export function createMixcloudProvider(): SearchProvider {
  return {
    id: "mixcloud",
    playback: "queue",
    searchable: true,

    async search(ctx, query, limit) {
      const data = await request<{ data?: MixcloudCloudcast[] }>(
        ctx,
        `${API}/search/?type=cloudcast&q=${encodeURIComponent(query)}&limit=${limit}`,
      );
      return (data?.data ?? [])
        .map(toSourceTrack)
        .filter((track): track is SourceTrack => track !== null);
    },
  };
}
