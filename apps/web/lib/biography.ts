import { normalizeLoose, parseTitle } from "@timbre/core";

import { createCache, type Cache } from "./cache.ts";

export interface Biography {
  extract: string;
  url: string;
  title: string;
}

export interface BiographyQuery {
  name: string;
  deezerId: string | null;
  releaseTitles: string[];
}

const USER_AGENT = "Timbre ( https://github.com/bishop076/timbre )";

const REVALIDATE_SECONDS = 86_400;

const DEADLINE_MS = 6_000;

const MUSICBRAINZ_GAP_MS = 1_100;

const MIN_SCORE = 90;

export interface MusicBrainzCandidate {
  id: string;
  name: string;
  score?: number;
}

export interface MusicBrainzRelation {
  type?: string;
  url?: { resource?: string };
}

export function pickArtist(name: string, candidates: MusicBrainzCandidate[]): string | null {
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

export function wikidataIdFrom(relations: MusicBrainzRelation[] | undefined): string | null {
  for (const relation of relations ?? []) {
    if (relation.type !== "wikidata") continue;
    const match = /wikidata\.org\/wiki\/(Q\d+)$/.exec(relation.url?.resource ?? "");
    if (match) return match[1]!;
  }
  return null;
}

export function enwikiTitleFrom(relations: MusicBrainzRelation[] | undefined): string | null {
  for (const relation of relations ?? []) {
    if (relation.type !== "wikipedia") continue;
    const match = /^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/.exec(
      relation.url?.resource ?? "",
    );
    if (!match) continue;
    try {
      return decodeURIComponent(match[1]!).replace(/_/g, " ");
    } catch {
    }
  }
  return null;
}

export function soleEntity(body: { query?: { search?: { title?: string }[] } } | null): string | null {
  const ids = (body?.query?.search ?? [])
    .map((hit) => hit.title ?? "")
    .filter((title) => /^Q\d+$/.test(title));
  return ids.length === 1 ? ids[0]! : null;
}

export function sitelinkTitle(
  body: { entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }> } | null,
  entity: string,
): string | null {
  return body?.entities?.[entity]?.sitelinks?.enwiki?.title ?? null;
}

export function sharesARelease(name: string, ours: string[], theirs: string[]): boolean {
  const self = normalizeLoose(name);
  const key = (title: string) => parseTitle(title).base;

  const mine = new Set(ours.map(key).filter((title) => title && title !== self));
  return theirs.some((title) => mine.has(key(title)));
}

export interface WikipediaSummary {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

export function readSummary(body: WikipediaSummary | null): Biography | null {
  if (!body || body.type !== "standard") return null;

  const extract = body.extract?.replace(/\s+([,.;:!?])/g, "$1").trim();
  const title = body.title?.trim();
  if (!extract || !title) return null;

  return {
    extract,
    title,
    url:
      body.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  };
}

const globalForBiography = globalThis as unknown as {
  __timbreBiographyCache?: Cache<Biography | null>;
  __timbreMusicBrainzNextSlot?: number;
};

function biographyCache(): Cache<Biography | null> {
  return (globalForBiography.__timbreBiographyCache ??= createCache<Biography | null>({
    ttlMs: REVALIDATE_SECONDS * 1000,
    max: 500,
  }));
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function musicBrainzTurn(signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, globalForBiography.__timbreMusicBrainzNextSlot ?? 0);
  globalForBiography.__timbreMusicBrainzNextSlot = slot + MUSICBRAINZ_GAP_MS;
  if (slot > now) await delay(slot - now, signal);
}

class UpstreamError extends Error {
  readonly status: number;

  constructor(host: string, status: number) {
    super(`${host} answered ${status}`);
    this.status = status;
  }
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal,
    next: { revalidate: REVALIDATE_SECONDS },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new UpstreamError(new URL(url).host, response.status);
  return (await response.json()) as T;
}

async function musicBrainz<T>(path: string, signal: AbortSignal): Promise<T | null> {
  for (let attempt = 0; ; attempt++) {
    await musicBrainzTurn(signal);
    try {
      return await getJson<T>(`https://musicbrainz.org/ws/2${path}`, signal);
    } catch (error) {
      if (attempt > 0 || !(error instanceof UpstreamError) || error.status !== 503) throw error;
    }
  }
}

async function enwikiTitleOf(entity: string, signal: AbortSignal): Promise<string | null> {
  const body = await getJson<Parameters<typeof sitelinkTitle>[0]>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${entity}&props=sitelinks&sitefilter=enwiki&format=json`,
    signal,
  );
  return sitelinkTitle(body, entity);
}

async function summaryOf(title: string, signal: AbortSignal): Promise<Biography | null> {
  const path = encodeURIComponent(title.replace(/ /g, "_"));
  return readSummary(
    await getJson<WikipediaSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${path}`, signal),
  );
}

async function byDeezerId(deezerId: string, signal: AbortSignal): Promise<Biography | null | undefined> {
  const found = await getJson<Parameters<typeof soleEntity>[0]>(
    `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P2722=${deezerId}&srnamespace=0&srlimit=3&format=json`,
    signal,
  );
  const entity = soleEntity(found);
  if (!entity) return undefined;

  const title = await enwikiTitleOf(entity, signal);
  return title ? summaryOf(title, signal) : null;
}

interface MusicBrainzArtist {
  relations?: MusicBrainzRelation[];
  "release-groups"?: { title?: string }[];
}

async function byName(query: BiographyQuery, signal: AbortSignal): Promise<Biography | null> {
  const phrase = `artist:"${query.name.replace(/["\\]/g, "\\$&")}"`;
  const found = await musicBrainz<{ artists?: MusicBrainzCandidate[] }>(
    `/artist?query=${encodeURIComponent(phrase)}&limit=5&fmt=json`,
    signal,
  );
  const id = pickArtist(query.name, found?.artists ?? []);
  if (!id) return null;

  const artist = await musicBrainz<MusicBrainzArtist>(
    `/artist/${id}?inc=url-rels+release-groups&type=album|ep|single&fmt=json`,
    signal,
  );
  if (!artist) return null;

  const theirs = (artist["release-groups"] ?? []).map((group) => group.title ?? "");
  if (!sharesARelease(query.name, query.releaseTitles, theirs)) return null;

  const entity = wikidataIdFrom(artist.relations);
  const title =
    enwikiTitleFrom(artist.relations) ?? (entity ? await enwikiTitleOf(entity, signal) : null);
  return title ? summaryOf(title, signal) : null;
}

export async function findBiography(query: BiographyQuery): Promise<Biography | null> {
  const deezerId = query.deezerId && /^\d+$/.test(query.deezerId) ? query.deezerId : null;
  if (!deezerId || !query.name.trim()) return null;

  try {
    return await biographyCache().take(deezerId, async () => {
      const signal = AbortSignal.timeout(DEADLINE_MS);
      const direct = await byDeezerId(deezerId, signal);
      return direct !== undefined ? direct : byName(query, signal);
    });
  } catch {
    return null;
  }
}
