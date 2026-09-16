type SourceStyle = { label: string; short: string; color: string };

/**
 * A `Map`, not an object literal, because the id looked up here is never Timbre's own word.
 *
 * It arrives from a stored song (`usableSong` copies `source` through unchanged), from a
 * provider answer, or from a chart name in an API response. A plain object answers
 * `"constructor"`, `"toString"` and `"__proto__"` with something off `Object.prototype`
 * rather than with nothing, so `SOURCE_STYLES[id] ?? fallback` never fell back for those
 * names: `sourceStyle("constructor")` returned the `Object` constructor and its `.label`
 * was `undefined`, which eleven call sites rendered as "Open on undefined", a badge with no
 * text and "Play from undefined". S-34's class again — fixed at the table this time rather
 * than at each of its readers, since the table is exported and a guard inside `sourceStyle`
 * could never cover a direct index of it.
 */
export const SOURCE_STYLES = new Map<string, SourceStyle>(
  Object.entries({
    ytmusic: { label: "YouTube Music", short: "YT Music", color: "#ff4e45" },
    soundcloud: { label: "SoundCloud", short: "SoundCloud", color: "#ff7700" },
    audius: { label: "Audius", short: "Audius", color: "#cc0fe0" },
    mixcloud: { label: "Mixcloud", short: "Mixcloud", color: "#5000ff" },
    archive: { label: "Live Music Archive", short: "Archive", color: "#3ba55c" },
    spotify: { label: "Spotify", short: "Spotify", color: "#1ed760" },
    deezer: { label: "Deezer", short: "Deezer", color: "#a238ff" },
    apple: { label: "Apple Music", short: "Apple", color: "#fa2d48" },
  }),
);

export function sourceStyle(id: string): SourceStyle {
  return SOURCE_STYLES.get(id) ?? { label: id, short: id, color: "var(--muted)" };
}
