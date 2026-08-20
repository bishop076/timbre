import { normalizeArtists, normalizeLoose } from "@timbre/core";

/**
 * Whether a credit line names the artist whose page this is.
 *
 * Searching a name returns their songs *and* everything that merely mentions them — covers,
 * tributes, "in the style of" uploads — so the artist page keeps only rows that credit them.
 *
 * **Whole names, not substrings.** An earlier version also accepted a credit *contained in*
 * the name, meant for artists who bill themselves differently upload to upload. What it
 * actually did was admit anyone whose name is a fragment of the one being searched: on
 * `/artist/le-real` the Houston rapper `Le$` normalizes to `le`, `"le real"` contains `"le"`,
 * and his record landed second among Lé Real's songs.
 *
 * The credit is split on its separators first, so a guest spot still counts — `Cozy
 * Collective, Lé Real & HYESUNG` is three names, one of which matches exactly. A longer
 * billing that contains the name as whole words is kept too, which is what the old arm was
 * reaching for, without matching inside a word.
 */
export function creditNames(name: string, credited: string): boolean {
  const target = normalizeLoose(name);
  if (!target) return false;
  if (normalizeArtists([credited]).includes(target)) return true;
  return ` ${normalizeLoose(credited)} `.includes(` ${target} `);
}
