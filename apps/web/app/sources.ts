/**
 * Per-source presentation.
 *
 * Each service gets its own brand colour so a result is recognisable at a
 * glance without reading — which matters when one song shows three or four
 * sources side by side.
 */

export interface SourceStyle {
  label: string;
  short: string;
  /** Brand colour, used for the badge text and border. */
  color: string;
  /** Background tint behind the badge. */
  tint: string;
}

export const SOURCE_STYLES: Record<string, SourceStyle> = {
  ytmusic: {
    label: "YouTube Music",
    short: "YT Music",
    color: "#ff4e45",
    tint: "rgba(255, 78, 69, 0.12)",
  },
  soundcloud: {
    label: "SoundCloud",
    short: "SoundCloud",
    color: "#ff7700",
    tint: "rgba(255, 119, 0, 0.12)",
  },
  audius: {
    label: "Audius",
    short: "Audius",
    color: "#cc0fe0",
    tint: "rgba(204, 15, 224, 0.12)",
  },
  mixcloud: {
    label: "Mixcloud",
    short: "Mixcloud",
    color: "#5000ff",
    tint: "rgba(80, 0, 255, 0.14)",
  },
  archive: {
    label: "Live Music Archive",
    short: "Archive",
    color: "#3ba55c",
    tint: "rgba(59, 165, 92, 0.12)",
  },
  spotify: {
    label: "Spotify",
    short: "Spotify",
    color: "#1ed760",
    tint: "rgba(30, 215, 96, 0.12)",
  },
  deezer: {
    label: "Deezer",
    short: "Deezer",
    color: "#a238ff",
    tint: "rgba(162, 56, 255, 0.12)",
  },
  apple: {
    label: "Apple Music",
    short: "Apple",
    color: "#fa2d48",
    tint: "rgba(250, 45, 72, 0.12)",
  },
};

export function sourceStyle(id: string): SourceStyle {
  return (
    SOURCE_STYLES[id] ?? {
      label: id,
      short: id,
      color: "var(--muted)",
      tint: "transparent",
    }
  );
}

/** Suggestions shown on the empty state, chosen to show off the catalogue. */
export const SUGGESTED_SEARCHES = [
  "Fred again..",
  "Wonderwall",
  "Aphex Twin",
  "boiler room set",
  "Sade",
  "lofi study mix",
];
