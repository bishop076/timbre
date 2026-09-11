type SourceStyle = { label: string; short: string; color: string };

export const SOURCE_STYLES: Record<string, SourceStyle> = {
  ytmusic: { label: "YouTube Music", short: "YT Music", color: "#ff4e45" },
  soundcloud: { label: "SoundCloud", short: "SoundCloud", color: "#ff7700" },
  audius: { label: "Audius", short: "Audius", color: "#cc0fe0" },
  mixcloud: { label: "Mixcloud", short: "Mixcloud", color: "#5000ff" },
  archive: { label: "Live Music Archive", short: "Archive", color: "#3ba55c" },
  spotify: { label: "Spotify", short: "Spotify", color: "#1ed760" },
  deezer: { label: "Deezer", short: "Deezer", color: "#a238ff" },
  apple: { label: "Apple Music", short: "Apple", color: "#fa2d48" },
};

export function sourceStyle(id: string): SourceStyle {
  return SOURCE_STYLES[id] ?? { label: id, short: id, color: "var(--muted)" };
}
