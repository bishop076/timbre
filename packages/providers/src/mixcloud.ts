// Mixcloud — the long form. Radio shows, DJ sets and mixes, keyless to search and driveable
// by script, which together make it the first source since Audius that can actually be a
// queue member rather than a panel.
//
// **It is the inverse of every other source here, and that is the point.** Asked for a song
// it returns mixes *named* after the song — *Wonderwall* gives DJ mixes called Wonderwall,
// not the Oasis track. Asked for the thing the rest of the catalogue cannot answer it is
// excellent: `boiler room set` returns five genuine Boiler Room sets, `Fred again..` the real
// Boiler Room London set and Glastonbury 2023, `lofi study mix` actual study mixes. Two of
// Timbre's own suggested searches go from nothing good to five right answers.
//
// **Entries are 40 to 130 minutes.** These are shows, not tracks. The README already promises
// DJ sets, so a queue that holds one is the product working rather than a surprise — but it
// is a different kind of object from a four-minute song and the ranker's spacing rules were
// not designed with it in mind.
//
// **The widget must stay visible and its logo must stay clickable** — the embed licence is
// explicitly personal and non-commercial. That is the same constraint the YouTube iframe
// already carries, so it costs nothing today.

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
  /** The canonical handle — `/user/slug/`. **Not** `url`, whose user segment is the display
   * name and which the widget will not accept. */
  key?: string;
  name?: string;
  /** Seconds. */
  audio_length?: number;
  user?: { name?: string; username?: string };
  pictures?: MixcloudPicture | null;
}

function toSourceTrack(raw: MixcloudCloudcast): SourceTrack | null {
  if (!raw.key || !raw.name) return null;

  const host = raw.user?.name?.trim() || raw.user?.username?.trim();

  return {
    source: "mixcloud",
    // The key, verbatim including both slashes — it is what the widget takes and what the
    // page URL is built from.
    sourceId: raw.key,
    title: raw.name.trim(),
    // The uploader, who for a radio show or a Boiler Room recording is the host rather than
    // the performer. Naming them the artist is the least wrong of the available options.
    artists: host ? [host] : [],
    album: null,
    durationMs: raw.audio_length ? raw.audio_length * 1000 : null,
    // No ISRC on a mix, and there could not be one — a set is not a recording in that sense.
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

/** The widget's feed parameter. Mirrored in `app/player/mixcloud-player.tsx`. */
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

    // No `chart`. Mixcloud publishes popular and hot feeds, but Explore fuses Deezer and
    // Apple so that agreeing on two beats charting higher on one, and a chart of hour-long
    // radio shows shares no population with either — the same reason Audius abstains there.
  };
}
