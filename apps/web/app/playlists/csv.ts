import { formatClock } from "../duration.ts";
import type { Song } from "../types";

const HEADER = ["Playlist", "#", "Title", "Artists", "Album", "Duration", "ISRC", "Sources", "Link"];

function duration(ms: number | null): string {
  return ms && ms > 0 ? formatClock(Math.round(ms / 1000)) : "";
}

export function csvField(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(defused) ? `"${defused.replaceAll('"', '""')}"` : defused;
}

export function playlistsToCsv(playlists: readonly { name: string; songs: Song[] }[]): string {
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
