import { setTimeout as sleep } from "node:timers/promises";

import { normalizeLoose, parseTitle } from "@timbre/core";

import { createCache, type Cache } from "./cache.ts";

interface Biography {
  extract: string;
  url: string;
  title: string;
}

export interface BiographyQuery {
  name: string;
  deezerId: string | null;
  releaseTitles: string[];
}

interface MusicBrainzRelation {
  type?: string;
  url?: { resource?: string };
}

interface WikipediaSummary {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

const USER_AGENT = "Timbre ( https://github.com/bishop076/timbre )";
const REVALIDATE_SECONDS = 86_400;
const DEADLINE_MS = 6_000;
const MUSICBRAINZ_GAP_MS = 1_100;
const MIN_SCORE = 90;

export function pickArtist(
  name: string,
  candidates: { id: string; name: string; score?: number }[],
): string | null {
  const wanted = normalizeLoose(name);
  if (!wanted) return null;

  const strong = candidates.filter(
    (candidate) => (candidate.score ?? 0) >= MIN_SCORE && normalizeLoose(candidate.name) === wanted,
  );
  const exact = strong.find(
    (candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  return (exact ?? strong[0])?.id ?? null;
}

function linked(relations: MusicBrainzRelation[] | undefined, type: string, pattern: RegExp) {
  return (relations ?? []).flatMap((relation) => {
    const match = relation.type === type ? pattern.exec(relation.url?.resource ?? "") : null;
    return match ? [match[1]!] : [];
  });
}

export function wikidataIdFrom(relations: MusicBrainzRelation[] | undefined): string | null {
  return linked(relations, "wikidata", /wikidata\.org\/wiki\/(Q\d+)$/)[0] ?? null;
}

export function enwikiTitleFrom(relations: MusicBrainzRelation[] | undefined): string | null {
  const pattern = /^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/;
  for (const path of linked(relations, "wikipedia", pattern)) {
    try {
      return decodeURIComponent(path).replace(/_/g, " ");
    } catch {}
  }
  return null;
}

export function soleEntity(body: { query?: { search?: { title?: string }[] } } | null): string | null {
  const ids = (body?.query?.search ?? [])
    .map((hit) => hit.title ?? "")
    .filter((title) => /^Q\d+$/.test(title));
  return ids.length === 1 ? ids[0]! : null;
}

export function sharesARelease(name: string, ours: string[], theirs: string[]): boolean {
  const self = normalizeLoose(name);
  const key = (title: string) => parseTitle(title).base;

  const mine = new Set(ours.map(key).filter((title) => title && title !== self));
  return theirs.some((title) => mine.has(key(title)));
}

const articlePath = (title: string) => encodeURIComponent(title.replace(/ /g, "_"));

export function readSummary(body: WikipediaSummary | null): Biography | null {
  if (!body || body.type !== "standard") return null;

  const extract = body.extract?.replace(/\s+([,.;:!?])/g, "$1").trim();
  const title = body.title?.trim();
  if (!extract || !title) return null;

  return {
    extract,
    title,
    url: body.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${articlePath(title)}`,
  };
}

const globalForBiography = globalThis as unknown as {
  __timbreBiographyCache?: Cache<Biography | null>;
  __timbreMusicBrainzNextSlot?: number;
};

async function musicBrainzTurn(signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, globalForBiography.__timbreMusicBrainzNextSlot ?? 0);
  const taken = slot + MUSICBRAINZ_GAP_MS;
  globalForBiography.__timbreMusicBrainzNextSlot = taken;
  if (slot <= now) return;

  try {
    await sleep(slot - now, undefined, { signal });
  } catch (cause) {
    // A caller that gave up never took its turn, and the queue advanced by a full gap anyway.
    // Six concurrent lookups was enough for that to push everyone behind them past the 6s
    // deadline, so they timed out too and gave their slots away in turn — an outage that fed
    // itself, from requests that were never sent. Hand the slot back if it is still ours.
    if (globalForBiography.__timbreMusicBrainzNextSlot === taken) {
      globalForBiography.__timbreMusicBrainzNextSlot = slot;
    }
    throw cause;
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const musicBrainz = url.startsWith("https://musicbrainz.org/");
  for (let attempt = 0; ; attempt++) {
    if (musicBrainz) await musicBrainzTurn(signal);
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal,
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (response.status === 404) return null;
    if (response.ok) return (await response.json()) as T;
    if (!musicBrainz || attempt > 0 || response.status !== 503) {
      throw new Error(`${new URL(url).host} answered ${response.status}`);
    }
  }
}

async function enwikiTitleOf(entity: string | null, signal: AbortSignal): Promise<string | null> {
  if (!entity) return null;
  const body = await getJson<{
    entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }>;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity}&props=sitelinks&sitefilter=enwiki&format=json`,
    signal,
  );
  return body?.entities?.[entity]?.sitelinks?.enwiki?.title ?? null;
}

async function titleByName(query: BiographyQuery, signal: AbortSignal): Promise<string | null> {
  const phrase = `artist:"${query.name.replace(/["\\]/g, "\\$&")}"`;
  const found = await getJson<{ artists?: Parameters<typeof pickArtist>[1] }>(
    `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(phrase)}&limit=5&fmt=json`,
    signal,
  );
  const id = pickArtist(query.name, found?.artists ?? []);
  if (!id) return null;

  const artist = await getJson<{
    relations?: MusicBrainzRelation[];
    "release-groups"?: { title?: string }[];
  }>(
    `https://musicbrainz.org/ws/2/artist/${id}?inc=url-rels+release-groups&type=album|ep|single&fmt=json`,
    signal,
  );
  const theirs = (artist?.["release-groups"] ?? []).map((group) => group.title ?? "");
  if (!artist || !sharesARelease(query.name, query.releaseTitles, theirs)) return null;

  return (
    enwikiTitleFrom(artist.relations) ?? enwikiTitleOf(wikidataIdFrom(artist.relations), signal)
  );
}

async function lookUp(query: BiographyQuery, deezerId: string): Promise<Biography | null> {
  const signal = AbortSignal.timeout(DEADLINE_MS);
  const claimants = await getJson<Parameters<typeof soleEntity>[0]>(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P2722=${deezerId}&srnamespace=0&srlimit=3&format=json`,
    signal,
  );
  const entity = soleEntity(claimants);
  const title = entity ? await enwikiTitleOf(entity, signal) : await titleByName(query, signal);
  if (!title) return null;

  return readSummary(
    await getJson<WikipediaSummary>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${articlePath(title)}`,
      signal,
    ),
  );
}

export async function findBiography(query: BiographyQuery): Promise<Biography | null> {
  const { deezerId } = query;
  if (!deezerId || !/^\d+$/.test(deezerId) || !query.name.trim()) return null;

  const cache = (globalForBiography.__timbreBiographyCache ??= createCache<Biography | null>({
    ttlMs: REVALIDATE_SECONDS * 1000,
    max: 500,
  }));
  try {
    return await cache.take(deezerId, () => lookUp(query, deezerId));
  } catch {
    return null;
  }
}
