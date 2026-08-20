/**
 * Whether a search result is plausibly the song that was asked for.
 *
 * Lives apart from the player so it can be tested: it is the guard that decides whether a
 * fall-through plays another copy of your song or something else entirely.
 */

import { dedupeParts } from "@timbre/core";

import type { Song } from "../types";

/** Words that carry meaning, lowercased. Punctuation and case differ constantly between
 * sources and never distinguish two songs. */
export function titleWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

/** Names compared the way a listener would: accents folded, punctuation gone, spaces kept
 * so a name still has to line up on word boundaries rather than anywhere inside a word. */
function normalizeName(value: string): string {
  return ` ${value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * Whether the two credit the same artist — allowing for the fact that a YouTube upload
 * often puts the artist in the *title* and a channel name in the artist field
 * (`Harry Styles - As It Was` by `HarryStylesVEVO`), so both are searched, both ways.
 *
 * Skipped rather than failed when either side credits nobody: a history row can arrive with
 * no artist at all, and refusing everything then would break the fall-through entirely.
 */
function sameArtist(seed: Song, found: Song): boolean {
  const seedNames = seed.artists.map(normalizeName).filter((name) => name.length > 3);
  const foundNames = found.artists.map(normalizeName).filter((name) => name.length > 3);
  if (seedNames.length === 0 || foundNames.length === 0) return true;

  const foundHay = normalizeName(`${found.artists.join(" ")} ${found.title}`);
  if (seedNames.some((name) => foundHay.includes(name))) return true;

  const seedHay = normalizeName(`${seed.artists.join(" ")} ${seed.title}`);
  return foundNames.some((name) => seedHay.includes(name));
}

/**
 * Whether they are the same length, when both say. A cover, a live take and a completely
 * different song all announce themselves here. Generous — an upload carries intros, outros
 * and silence a catalogue does not — so it only catches the gross mismatches.
 */
function sameLength(seed: Song, found: Song): boolean {
  if (!seed.durationMs || !found.durationMs) return true;
  const gap = Math.abs(seed.durationMs - found.durationMs);
  return gap <= Math.max(20_000, seed.durationMs * 0.25);
}

/**
 * Whether a search result is plausibly the song that was asked for.
 *
 * A search is a *guess* — it returns the best matches for some words, and the best match for
 * words nothing carries is still something. Playing that as the song is how *"I'm laughing,
 * but I just might cry"* became a cat video, and it is a whole class of failure rather than
 * one bad result: any title that is an ordinary sentence will find a confident stranger.
 *
 * Half the seed's words, at least two of them, appearing in the candidate's title or artist.
 * Deliberately loose — `As It Was` must still match `As It Was (Official Video)` and
 * `Wonderwall` must still match `Wonderwall - Remastered`, because those *are* the song and
 * rejecting them would break the fall-through this exists to serve.
 */
export function plausiblySameSong(seed: Song, found: Song): boolean {
  // **Shared words alone are not evidence.** Titles are ordinary English, and ordinary
  // English repeats: "This Was Your Song" matched "Wash Your Hands Song" on *your* and
  // *song*, and "Just Because of You" matched Ne-Yo's "Because Of You" on *because*, *of*
  // and *you*. Both cleared the word test outright, and both were reported as an unrelated
  // song playing. Who made it, and how long it runs, are what actually separate them.
  if (!sameArtist(seed, found)) return false;
  if (!sameLength(seed, found)) return false;

  const wanted = titleWords(seed.title);
  if (wanted.length === 0) return true;

  const haystack = new Set(titleWords(`${found.title} ${found.artists.join(" ")}`));
  const hits = wanted.filter((word) => haystack.has(word)).length;

  return hits >= Math.max(2, Math.ceil(wanted.length / 2)) || hits === wanted.length;
}

/**
 * Whether two rows are the same recording — for deciding a **duplicate**, not for deciding
 * what to play.
 *
 * A separate question from {@link plausiblySameSong}, and deliberately not built on it. That
 * one scores shared words across the whole raw title, which is right when the alternative is
 * playing nothing, but here decoration is shared between unrelated songs: `Strange Land
 * (Acoustic Version)` and `La La Lost You (Acoustic Version)` clear its threshold on
 * *acoustic* and *version* alone, so a real suggestion disappeared as a duplicate. Measured
 * against a live NIKI radio, which is where that pair came from.
 *
 * `parseTitle` already separates a title's name from its packaging, so this compares the
 * names: `Pandemonium` and `Pandemonium (Visualizer Video)` share a base, `Strange Land` and
 * `La La Lost You` do not, and no threshold has to be guessed at.
 *
 * **Variants are ignored, unlike the merger's own key.** An acoustic take is a different
 * recording — which is why `dedupeKey` keeps them apart, and why the radio may legitimately
 * list both — but offering the acoustic of a song already queued is a weak suggestion, and
 * this panel would rather be short than repeat itself.
 */
export function sameRecording(a: Song, b: Song): boolean {
  // Settles the ordinary case for nothing: both lists come from the same merge, which
  // derives an id from the ISRC or the dedupe key, so a repeat arrives already identical.
  if (a.id === b.id) return true;
  if (a.isrc && b.isrc) return a.isrc === b.isrc;

  const left = dedupeParts(a.title, a.artists);
  const right = dedupeParts(b.title, b.artists);
  if (!left.base || left.base !== right.base) return false;

  // Same name is not enough — NIKI and Drake both have a *Take Care*. Skipped rather than
  // failed when either side credits nobody, since a row can arrive with no artist at all.
  if (left.artists.length === 0 || right.artists.length === 0) return true;
  return left.artists.some((name) => right.artists.includes(name));
}
