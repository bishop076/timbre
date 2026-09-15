import { normalizeArtists, normalizeLoose, parseTitle, parseVersions } from "@timbre/core";

import { PLAYBACK_RANK, type SourceTrack } from "./types.ts";

/**
 * What every provider's relevance order has in common: none of them answers the question the
 * reader asked.
 *
 * Search for "wonderwall" and Deezer's own top five are five covers — the Oasis recording is not
 * in it at all — SoundCloud leads with whoever uploaded most recently, and Mixcloud offers DJ
 * sets that play the song an hour in. Interleaving those lists by playability, which is all the
 * search route used to do, put a cover first and filled the page with live cuts and remixes; the
 * reader who typed one word got somebody else's version of it. `app/player/song-match.ts` has
 * known how to tell those apart for as long as the player has been resolving a chosen song —
 * "a famous live cut and a cover ... can both outrank the studio recording", says its comment —
 * but nothing applied that knowledge to the list the reader picks from.
 *
 * So this scores tracks the way that comment describes, on the list itself:
 *
 *  - A version tag the query did not ask for is the strongest signal there is. "Wonderwall
 *    (Live at Wembley)" answers "wonderwall live" and not "wonderwall"; the reverse is also
 *    true, which is why asking for a tag and not getting it costs as well. Tags are demoted,
 *    never dropped: a variant is still a result, and for some readers it is the right one.
 *  - Every word of the query should be in the track, and the words of the title that the query
 *    did not ask for are noise. That is what separates the song from the ninety-minute mix whose
 *    tracklist happens to mention it.
 *  - Where a query word is found matters as much as whether it is. "daft punk around the world"
 *    names an artist and a song, and the row credited to Daft Punk is the recording, while the
 *    row that repeats the whole query in its title is an upload named after a search box. So the
 *    part of the query that names an artist somebody in the result set is credited as is taken
 *    off before titles are compared, and matching it in the credits scores on its own.
 *  - Covers are one-offs; the original is the name the whole result set keeps repeating. Fifteen
 *    of the eighty-eight rows for "wonderwall" say "Oasis" somewhere, and no cover artist says
 *    their own name twice, so the name the corpus agrees on can be scored without knowing
 *    anything about music.
 *
 * Playability stays in the score, below all of that, and the incoming order breaks ties — so
 * among equally good answers the one Timbre can actually play still leads, which is what
 * `interleaveByPlayability` was for.
 */

const UNASKED_VERSION = 3;
const MISSING_VERSION = 4;
const MAX_VERSION_PENALTY = 3;
const QUERY_COVERAGE = 4;
const EXACT_TITLE = 2;
const TITLE_NOISE = 0.4;
const MAX_TITLE_NOISE = 3;
const CONSENSUS_ARTIST = 2;
const CREDIT_MATCH = 1.5;
const PLAYABILITY = 0.6;
const LONG_PLAYER = 2;

/** Past this, it is a DJ set or a radio show that happens to contain the song, not the song. */
const SET_LENGTH_MS = 900_000;

/** Enough repeats to be a consensus rather than one uploader's back catalogue. */
const CONSENSUS_FLOOR = 3;

interface Ask {
  tags: string[];
  /** The query with its version words and any artist it names taken out: the song, by itself. */
  base: string;
  words: string[];
}

function words(text: string): string[] {
  const normalized = normalizeLoose(text);
  return normalized ? normalized.split(" ") : [];
}

function padded(text: string): string {
  return ` ${normalizeLoose(text)} `;
}

function textOf(track: SourceTrack): string {
  return `${track.title} ${track.artists.join(" ")}`;
}

/**
 * The artist the whole result set keeps naming, or null when it cannot agree on one.
 *
 * A name the query already contains is skipped: searching "wonderwall" turns up an artist
 * *called* Wonderwall, and counting that name would match nearly every row and tell us nothing.
 * The runner-up has to be half the winner or less, so an ambiguous query — two songs of the same
 * name by comparable artists — simply has no consensus and nobody gets the bonus.
 */
export function consensusArtist(tracks: SourceTrack[], query: string): string | null {
  const asked = padded(query);
  const haystacks = tracks.map((track) => padded(textOf(track)));
  const names = new Set(
    tracks
      .flatMap((track) => normalizeArtists(track.artists))
      .filter((name) => name.length >= 4 && !asked.includes(` ${name} `)),
  );

  let winner: string | null = null;
  let best = 0;
  let runnerUp = 0;
  for (const name of names) {
    const count = haystacks.filter((hay) => hay.includes(` ${name} `)).length;
    if (count > best) {
      runnerUp = best;
      best = count;
      winner = name;
    } else if (count > runnerUp) {
      runnerUp = count;
    }
  }
  return winner && best >= CONSENSUS_FLOOR && best >= runnerUp * 2 ? winner : null;
}

/**
 * The query with the artist it names taken out, leaving the song.
 *
 * Only a name the result set actually credits somebody as counts, so "wonderwall" is not read as
 * an artist just because a band happens to be called that — and a query that is *entirely* an
 * artist name keeps it, because "radiohead" is still asking for something.
 */
function songAsked(base: string, artists: string[]): string {
  let rest = ` ${base} `;
  for (const name of artists) {
    const without = rest.replace(` ${name} `, " ").trim().replace(/\s+/g, " ");
    if (without) rest = ` ${without} `;
  }
  return rest.trim();
}

function queriedArtists(tracks: SourceTrack[], query: string): string[] {
  const asked = padded(query);
  return [
    ...new Set(
      tracks
        .flatMap((track) => normalizeArtists(track.artists))
        .filter((name) => name.length >= 3 && asked.includes(` ${name} `)),
    ),
  ];
}

function score(track: SourceTrack, ask: Ask, consensus: string | null): number {
  const text = textOf(track);
  const tags = parseVersions(text).tags;
  const unasked = tags.filter((tag) => !ask.tags.includes(tag)).length;
  const missing = ask.tags.filter((tag) => !tags.includes(tag)).length;

  const inTitle = new Set(words(track.title));
  const inCredits = new Set(words(track.artists.join(" ")));
  const hits = ask.words.filter((word) => inTitle.has(word) || inCredits.has(word));
  const credited = ask.words.filter((word) => inCredits.has(word) && !inTitle.has(word));
  const coverage = ask.words.length === 0 ? 1 : hits.length / ask.words.length;
  const byCredit = ask.words.length === 0 ? 0 : credited.length / ask.words.length;

  // Noise is counted over the title alone. Counting it over the credits too would quietly
  // reward whoever has the shortest name, which is not a fact about the recording.
  const wanted = new Set(ask.words);
  const noise = words(track.title).filter((word) => !wanted.has(word)).length;

  const base = parseTitle(track.title, track.artists).base;
  const isSet = track.durationMs !== null && track.durationMs > SET_LENGTH_MS;

  return (
    QUERY_COVERAGE * coverage +
    CREDIT_MATCH * byCredit +
    (base === ask.base ? EXACT_TITLE : 0) +
    (consensus && padded(text).includes(` ${consensus} `) ? CONSENSUS_ARTIST : 0) -
    UNASKED_VERSION * Math.min(unasked, MAX_VERSION_PENALTY) -
    MISSING_VERSION * missing -
    Math.min(noise * TITLE_NOISE, MAX_TITLE_NOISE) -
    PLAYABILITY * PLAYBACK_RANK[track.playback] -
    (isSet ? LONG_PLAYER : 0)
  );
}

/**
 * Search results in the order the reader asked for them.
 *
 * Stable: equal scores keep the order they arrived in, so the playability interleave underneath
 * still decides between two answers this has nothing to say about.
 */
export function rankSearchResults(tracks: SourceTrack[], query: string): SourceTrack[] {
  const asked = parseVersions(query);
  const ask: Ask = {
    tags: asked.tags,
    base: songAsked(normalizeLoose(asked.rest), queriedArtists(tracks, query)),
    words: words(query),
  };
  const consensus = consensusArtist(tracks, query);

  return tracks
    .map((track, order) => ({ track, order, score: score(track, ask, consensus) }))
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map((entry) => entry.track);
}
