import type { Song } from "../types";

/**
 * Playlists as a spreadsheet. JSON is the format that round-trips — this one is for reading,
 * sorting and sharing with someone who has no Timbre, so it carries what a person wants in
 * a column and nothing an import would need. There is deliberately no CSV import: a column
 * of titles is not enough to find the same recording again, and pretending otherwise would
 * quietly swap songs.
 */

interface CsvPlaylist {
  name: string;
  songs: Song[];
}

const HEADER = ["Playlist", "#", "Title", "Artists", "Album", "Duration", "ISRC", "Sources", "Link"];

/** `m:ss`, or empty — a zero would read as a real length. */
function duration(ms: number | null): string {
  if (!ms || ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * One field, quoted per RFC 4180 and defused for spreadsheets.
 *
 * **A song title is written by whoever uploaded it**, and a spreadsheet treats a cell that
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return as a formula — so a title like
 * `=HYPERLINK(…)` becomes a live link the moment the file is opened. The OWASP remedy is a
 * leading apostrophe, which every spreadsheet reads as "this is text" and does not display.
 */
export function csvField(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}

/** Every playlist, one row per entry, in list order. CRLF and a BOM, because that is what
 * makes Excel read UTF-8 — without the BOM every accented artist arrives as mojibake. */
export function playlistsToCsv(playlists: readonly CsvPlaylist[]): string {
  const rows = [HEADER];
  for (const playlist of playlists) {
    playlist.songs.forEach((song, position) => {
      rows.push([
        playlist.name,
        String(position + 1),
        song.title,
        song.artists.join(", "),
        song.album ?? "",
        duration(song.durationMs),
        song.isrc ?? "",
        [...new Set(song.sources.map((source) => source.source))].join(" "),
        song.sources.find((source) => source.url)?.url ?? "",
      ]);
    });
  }
  return `﻿${rows.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`;
}
