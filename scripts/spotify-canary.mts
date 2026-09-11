import { appendFileSync, writeFileSync } from "node:fs";

import { MemoryBucketStore, RateLimiter } from "../packages/core/src/index.ts";
import {
  discoverHashesFrom,
  fetchSpotifyCollection,
  fetchSpotifyCollectionFromEmbed,
  healedSpotifyHashes,
  searchSpotifyWeb,
  SPOTIFY_OPERATIONS,
  type OperationKey,
  type SourceTrack,
} from "../packages/providers/src/index.ts";

const ALBUM = { id: "2noRn2Aes5aoNVsU6iWThc", title: "Discovery", minTracks: 10 };
const PLAYLIST = { id: "37i9dQZF1DXcBWIGoYBM5M", minTracks: 20 };
const EMBED_FIX = "See collectionFromEmbed in spotify-web.ts.";

interface Outcome {
  level: "ok" | "warn" | "fail";
  detail: string;
  fix?: string;
}

const ctx = { limiter: new RateLimiter(new MemoryBucketStore()) };
const results: (Outcome & { check: string })[] = [];

const drill = process.argv.includes("--drill");
if (drill) (SPOTIFY_OPERATIONS.search as { sha256: string }).sha256 = "0".repeat(64);

const names = (keys: OperationKey[]) => keys.map((key) => SPOTIFY_OPERATIONS[key].name).join(", ");
const table = (keys: OperationKey[], hashes: Partial<Record<OperationKey, string>>) =>
  keys.map((key) => `  ${key}: "${hashes[key]}"`).join("\n");

async function check(name: string, run: () => Promise<Outcome>): Promise<void> {
  const started = Date.now();
  try {
    const result = await run();
    results.push({ check: name, ...result, detail: `${result.detail} (${Date.now() - started}ms)` });
  } catch (cause) {
    results.push({
      check: name,
      level: "fail",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function flaw(track: SourceTrack): string | null {
  if (!/^[A-Za-z0-9]{22}$/.test(track.sourceId)) return `bad id "${track.sourceId}"`;
  if (!track.title) return "no title";
  if (track.artists.length === 0) return `"${track.title}" has no artists`;
  if (!track.durationMs) return `"${track.title}" has no duration`;
  if (!track.artworkUrl) return `"${track.title}" has no cover`;
  return null;
}

function judge(tracks: SourceTrack[], min: number, what: string): Outcome {
  if (tracks.length < min) {
    return {
      level: "fail",
      detail: `${tracks.length} ${what}, expected at least ${min}`,
      fix: "The payload shape has probably moved. Compare a live response against the parsers in spotify-web.ts.",
    };
  }
  const bad = tracks.map(flaw).find((problem) => problem !== null);
  if (bad) {
    return {
      level: "fail",
      detail: `${tracks.length} ${what}, but ${bad}`,
      fix: "A field has moved in the payload. Compare a live response against toSourceTrack in spotify-web.ts.",
    };
  }
  return { level: "ok", detail: `${tracks.length} ${what}, first "${tracks[0]!.title}"` };
}

await check("Search (pathfinder searchDesktop)", async () =>
  judge(await searchSpotifyWeb(ctx, "daft punk", 10), 5, "tracks"),
);

await check("Album (pathfinder getAlbum)", async () => {
  const album = await fetchSpotifyCollection(ctx, "album", ALBUM.id, { fallback: false });
  if (!album) return { level: "fail", detail: "no album came back", fix: "Spotify may have withdrawn it; if so, pick another long-lived album." };
  if (album.title !== ALBUM.title) return { level: "fail", detail: `title "${album.title}", expected "${ALBUM.title}"` };
  return judge(album.tracks, ALBUM.minTracks, "tracks");
});

await check("Playlist (pathfinder fetchPlaylist)", async () => {
  const playlist = await fetchSpotifyCollection(ctx, "playlist", PLAYLIST.id, { fallback: false });
  if (!playlist) return { level: "fail", detail: "no playlist came back" };
  return judge(playlist.tracks, PLAYLIST.minTracks, `tracks in "${playlist.title}"`);
});

for (const [label, kind, { id, minTracks }, fix] of [
  ["Album", "album", ALBUM, `The embed page's __NEXT_DATA__ has changed shape. ${EMBED_FIX}`],
  ["Playlist", "playlist", PLAYLIST, EMBED_FIX],
] as const) {
  await check(`${label} fallback (embed page)`, async () => {
    const count = (await fetchSpotifyCollectionFromEmbed(ctx, kind, id))?.tracks.length ?? 0;
    const detail = `${count} tracks from the embed page`;
    return count >= minTracks ? { level: "ok", detail } : { level: "fail", detail, fix };
  });
}

const healed = healedSpotifyHashes();
const healedKeys = Object.keys(healed) as OperationKey[];
results.push(
  healedKeys.length === 0
    ? { check: "Hash table", level: "ok", detail: "every shipped hash was accepted" }
    : {
        check: "Hash table",
        level: "fail",
        detail: `Spotify retired ${names(healedKeys)}; self-repair covered it`,
        fix: `Update SPOTIFY_OPERATIONS in packages/providers/src/spotify-web.ts:\n${table(healedKeys, healed)}`,
      },
);

await check("Self-repair sources", async () => {
  const { hashes, from } = await discoverHashesFrom(ctx, true);
  const keys = Object.keys(SPOTIFY_OPERATIONS) as OperationKey[];
  const missing = keys.filter((key) => !hashes[key]);
  const upstreamOnly = keys.filter((key) => from[key] === "upstream");
  const newer = keys.filter(
    (key) => hashes[key] && hashes[key] !== SPOTIFY_OPERATIONS[key].sha256 && !healedKeys.includes(key),
  );

  if (missing.length > 0) {
    return {
      level: "fail",
      detail: `no source knows ${names(missing)}`,
      fix: "Spotify's web-player bundle has changed layout. Check discoverHashesFrom and chunkUrl in spotify-web.ts.",
    };
  }
  if (upstreamOnly.length > 0) {
    return {
      level: "warn",
      detail: `Spotify's bundle no longer yields ${names(upstreamOnly)}; SpotifyScraper's table still does`,
      fix: "The bundle layout moved. Check discoverHashesFrom and chunkUrl before the second source goes too.",
    };
  }
  if (newer.length > 0) {
    return {
      level: "warn",
      detail: `Spotify's web player has moved on to newer hashes for ${names(newer)} — the shipped ones still work`,
      fix: `Worth updating SPOTIFY_OPERATIONS before the old ones are retired:\n${table(newer, hashes)}`,
    };
  }
  return { level: "ok", detail: "Spotify's bundle yields every hash, and they match the table" };
});

const ICON = { ok: "✅", warn: "⚠️", fail: "❌" };
const code = (text: string) => `\`${text.replace(/[`\s]+/g, " ").trim().replace(/\|/g, "\\|")}\``;
const failed = results.filter((result) => result.level === "fail");
const warned = results.filter((result) => result.level === "warn");

const lines = [
  `## Spotify canary — ${failed.length ? `${failed.length} failing` : warned.length ? `passing, ${warned.length} warning${warned.length === 1 ? "" : "s"}` : "all passing"}`,
  "",
  `Checked ${new Date().toISOString()} against the live service.${
    drill ? " **This was a drill:** the search hash was blanked on purpose to prove the alarm works." : ""
  }`,
  "",
  "| | Check | Result |",
  "|---|---|---|",
  ...results.map((result) => `| ${ICON[result.level]} | ${result.check} | ${code(result.detail)} |`),
];
for (const result of [...failed, ...warned]) {
  if (!result.fix) continue;
  const block = result.fix.includes("\n");
  lines.push("", `**${result.check}.** ${block ? "" : result.fix}`);
  if (block) lines.push("```", result.fix, "```");
}
if (failed.some((result) => result.check !== "Hash table")) {
  lines.push(
    "",
    "Listeners see this as: search's \"On Spotify\" section falling back to a connected account or saying Spotify did not answer, and pasted albums and playlists opening from their embed page or not at all. See `docs/SEARCH-ROUTES.md` R10.",
  );
} else if (failed.length) {
  lines.push(
    "",
    "Listeners are unaffected: the self-repair found the new hash. Updating the table spares every server instance a 4MB download of Spotify's web player before its first answer.",
  );
}

const report = lines.join("\n");
console.log(report);

const reportPath = process.argv.includes("--report") ? process.argv[process.argv.indexOf("--report") + 1] : undefined;
if (reportPath) writeFileSync(reportPath, `${report}\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

process.exitCode = failed.length ? 1 : 0;
