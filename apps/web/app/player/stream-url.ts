const PROGRESSIVE_SOURCES = ["audius", "archive"] as const;

export type ProgressiveSource = (typeof PROGRESSIVE_SOURCES)[number];

export function isProgressive(source: string): source is ProgressiveSource {
  return (PROGRESSIVE_SOURCES as readonly string[]).includes(source);
}

const AUDIUS_HOSTS = [
  "https://api.audius.co",
  "https://discoveryprovider.audius.co",
  "https://discoveryprovider2.audius.co",
  "https://discoveryprovider3.audius.co",
] as const;

export function streamUrlFor(source: ProgressiveSource, sourceId: string): string {
  if (source === "audius") {
    return `${AUDIUS_HOSTS[0]}/v1/tracks/${encodeURIComponent(sourceId)}/stream?skip_play_count=false`;
  }
  return `https://archive.org/download/${sourceId.split("/").map(encodeURIComponent).join("/")}`;
}

export function nextStreamHost(url: string): string | null {
  for (let index = 0; index < AUDIUS_HOSTS.length - 1; index++) {
    const host = AUDIUS_HOSTS[index]!;
    if (url.startsWith(`${host}/`)) return `${AUDIUS_HOSTS[index + 1]}${url.slice(host.length)}`;
  }
  return null;
}
