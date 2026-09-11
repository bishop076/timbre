// An artist's biography: the lead of their English Wikipedia article, which the Wikimedia
// REST API serves keyless and licenses for reuse with attribution (CC BY-SA). Finding the
// *right* article is the whole problem — a name is not an identity, and a stranger's life
// story under an artist's picture is worse than no story at all.
//
// So a biography is only ever reached from the Deezer profile the page already resolved,
// and only when a second catalogue agrees who that is:
//
//   1. Wikidata records Deezer artist ids (P2722). When exactly one entity claims this one,
//      that entity is the artist, and its enwiki sitelink is the article.
//   2. Otherwise MusicBrainz, by name: a strong match only, then its own Wikipedia or
//      Wikidata link — accepted only if its releases overlap Deezer's. `Boiler Room` is
//      why: MusicBrainz's one exact match is a nu-metal band with an article, which the
//      name alone cannot tell from the broadcaster. Measured 2026-09-11, Deezer's "Boiler
//      Room" is that band — *Rectify*, *Can't Breathe* — so the article shows; had it been
//      the broadcaster's uploads, nothing would.
//
// Non-music articles are excluded by construction: both routes start from a music catalogue.
// Every failure is `null` — a missing biography must never cost the page anything. No
// `server-only` guard, for the same reason as `cache.ts`: that import throws outside a server
// component, and the matching below is the part most worth testing.

import { normalizeLoose, parseTitle } from "@timbre/core";

import { createCache, type Cache } from "./cache.ts";

export interface Biography {
  /** The article's lead, as plain text. */
  extract: string;
  /** The article itself, for "More on Wikipedia" — and the attribution CC BY-SA asks for. */
  url: string;
  title: string;
}

export interface BiographyQuery {
  /** Deezer's spelling of the name, which is closer to MusicBrainz's than a URL slug is. */
  name: string;
  deezerId: string | null;
  /** Titles of the artist's releases on Deezer, to corroborate a match made by name. */
  releaseTitles: string[];
}

/** MusicBrainz and Wikimedia both ask clients to identify themselves with a way to reach
 * the operator — MusicBrainz `403`s a generic agent outright (docs/BLOCKED.md). */
const USER_AGENT = "Timbre ( https://github.com/bishop076/timbre )";

/** A day, like every other fact about an artist Timbre fetches. Short enough that an edit
 * to the article — or a vandalised lead, reverted — does not linger for a week. */
const REVALIDATE_SECONDS = 86_400;

/** The whole lookup, all hops included. It streams in behind the page, so this bounds how
 * long a response is held open rather than how long anyone waits to see songs. */
const DEADLINE_MS = 6_000;

/** MusicBrainz allows one request a second per client and answers `503` beyond it. A
 * little over, since two instances' clocks do not agree to the millisecond. */
const MUSICBRAINZ_GAP_MS = 1_100;

/** A name-search score below this is MusicBrainz saying it is guessing. */
const MIN_SCORE = 90;

// -- The pure part --------------------------------------------------------------------------

export interface MusicBrainzCandidate {
  id: string;
  name: string;
  score?: number;
}

export interface MusicBrainzRelation {
  type?: string;
  url?: { resource?: string };
}

/**
 * The MusicBrainz artist a name refers to, or `null` when the search was only close.
 *
 * Same name once normalised — accents and punctuation vary between catalogues, `Sigur Ros`
 * and `Sigur Rós` are one band — and a score MusicBrainz is sure of. Among those, an exact
 * case-insensitive spelling first, then MusicBrainz's own order, which ranks the well-known
 * namesake ahead: its "Sade" is the band, and the four other Sades score in the seventies.
 */
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

/** The Wikidata entity id MusicBrainz links an artist to, if any. */
export function wikidataIdFrom(relations: MusicBrainzRelation[] | undefined): string | null {
  for (const relation of relations ?? []) {
    if (relation.type !== "wikidata") continue;
    const match = /wikidata\.org\/wiki\/(Q\d+)$/.exec(relation.url?.resource ?? "");
    if (match) return match[1]!;
  }
  return null;
}

/** An English Wikipedia title from a direct MusicBrainz link. Other languages are skipped:
 * the summary endpoint used here is English Wikipedia's, and Wikidata can still get there. */
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
      // A malformed escape in someone's edit is not worth failing over; try the next link.
    }
  }
  return null;
}

/** The one entity a Wikidata search found. Two claiming the same Deezer id is a data error
 * — Deezer's "Sade" is claimed by both the band and its singer — and picking one would be a
 * guess, so the name route decides instead. */
export function soleEntity(body: { query?: { search?: { title?: string }[] } } | null): string | null {
  const ids = (body?.query?.search ?? [])
    .map((hit) => hit.title ?? "")
    .filter((title) => /^Q\d+$/.test(title));
  return ids.length === 1 ? ids[0]! : null;
}

/** The English Wikipedia title from a `wbgetentities` answer. */
export function sitelinkTitle(
  body: { entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }> } | null,
  entity: string,
): string | null {
  return body?.entities?.[entity]?.sitelinks?.enwiki?.title ?? null;
}

/**
 * Whether two catalogues list at least one release in common — the corroboration a match by
 * name needs. Titles go through `parseTitle`, the same noise-stripping the song merger uses,
 * so "Diamond Life (Remastered)" still meets "Diamond Life". A self-titled record does not
 * count: it is the one title two namesakes are most likely to share.
 */
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

/** A summary worth showing, or `null`. Only `standard` pages: a `disambiguation` page's
 * extract is "X may refer to:", and the other types have no prose at all. */
export function readSummary(body: WikipediaSummary | null): Biography | null {
  if (!body || body.type !== "standard") return null;

  // The summary drops some parentheticals and keeps the space before them, so Radiohead's
  // lead read "Thom Yorke ; the brothers…". Closed up rather than shown as found.
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

// -- The fetching part ----------------------------------------------------------------------

const globalForBiography = globalThis as unknown as {
  __timbreBiographyCache?: Cache<Biography | null>;
  __timbreMusicBrainzNextSlot?: number;
};

/** On `globalThis` for the reason `api.ts` gives: hot reload re-evaluates modules, and a
 * rebuilt cache — or pacer — has forgotten everything. */
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

/** Waits for this instance's next MusicBrainz slot. Per instance, like every limiter here —
 * see `providers.ts` — so it keeps one server polite rather than a deployment. */
async function musicBrainzTurn(signal: AbortSignal): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, globalForBiography.__timbreMusicBrainzNextSlot ?? 0);
  globalForBiography.__timbreMusicBrainzNextSlot = slot + MUSICBRAINZ_GAP_MS;
  if (slot > now) await delay(slot - now, signal);
}

/** Plain fields rather than parameter properties, which `node --test`'s type stripping
 * cannot erase. */
class UpstreamError extends Error {
  readonly status: number;

  constructor(host: string, status: number) {
    super(`${host} answered ${status}`);
    this.status = status;
  }
}

/**
 * One JSON request. `404` is an answer — nothing there — and comes back as `null`, which is
 * cached. Anything else that is not `200` throws: MusicBrainz says "busy" with a `503`, and
 * storing that as "no biography" would hide one for a day over one bad second. Next's fetch
 * cache stores only `200`s, so a throw is retried by the next render.
 */
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

/** A paced MusicBrainz request, retried once on `503`. That status is load-shedding, not a
 * verdict: measured, a tight burst lost three calls in ten and the same calls answered a
 * moment later (docs/RESEARCH-2026-08-20.md, G-8). The retry waits its turn like any call. */
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
  // Slashes too: `AC/DC` is one title, and the REST route reads a bare `/` as a path segment.
  const path = encodeURIComponent(title.replace(/ /g, "_"));
  return readSummary(
    await getJson<WikipediaSummary>(`https://en.wikipedia.org/api/rest_v1/page/summary/${path}`, signal),
  );
}

/** Route 1: the entity that claims this Deezer id. `undefined` means "no single claimant,
 * ask by name"; `null` means the artist was found and has no English article. */
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

/** Route 2: MusicBrainz by name, corroborated by releases. Two MusicBrainz requests, so at
 * least a second of pacing — the reason it is the fallback rather than the first try. */
async function byName(query: BiographyQuery, signal: AbortSignal): Promise<Biography | null> {
  // Quoted, so a name is a phrase rather than Lucene syntax; only `"` and `\` need escaping.
  const phrase = `artist:"${query.name.replace(/["\\]/g, "\\$&")}"`;
  const found = await musicBrainz<{ artists?: MusicBrainzCandidate[] }>(
    `/artist?query=${encodeURIComponent(phrase)}&limit=5&fmt=json`,
    signal,
  );
  const id = pickArtist(query.name, found?.artists ?? []);
  if (!id) return null;

  // Links and releases in one request. Up to 25 release groups, albums first — plenty for
  // one title in common, and a single request less against the one-a-second budget.
  const artist = await musicBrainz<MusicBrainzArtist>(
    `/artist/${id}?inc=url-rels+release-groups&type=album|ep|single&fmt=json`,
    signal,
  );
  if (!artist) return null;

  const theirs = (artist["release-groups"] ?? []).map((group) => group.title ?? "");
  if (!sharesARelease(query.name, query.releaseTitles, theirs)) return null;

  // A direct link saves a hop; Wikidata's sitelink follows renames, so it is the fallback.
  const entity = wikidataIdFrom(artist.relations);
  const title =
    enwikiTitleFrom(artist.relations) ?? (entity ? await enwikiTitleOf(entity, signal) : null);
  return title ? summaryOf(title, signal) : null;
}

/** The biography for the artist behind a Deezer profile, or `null`. Never throws. */
export async function findBiography(query: BiographyQuery): Promise<Biography | null> {
  const deezerId = query.deezerId && /^\d+$/.test(query.deezerId) ? query.deezerId : null;
  // Without a profile there is nothing to corroborate a name against, and a name alone is
  // exactly how the wrong article gets chosen.
  if (!deezerId || !query.name.trim()) return null;

  try {
    return await biographyCache().take(deezerId, async () => {
      const signal = AbortSignal.timeout(DEADLINE_MS);
      const direct = await byDeezerId(deezerId, signal);
      return direct !== undefined ? direct : byName(query, signal);
    });
  } catch {
    // Slow, busy or unreachable — not stored, so the next render asks again.
    return null;
  }
}
