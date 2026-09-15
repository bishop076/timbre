import { z } from "zod";

/**
 * What a query parameter has to be cleaned of before it is a query.
 *
 * Nearly all of this text was pasted — off a track list, a lyrics page, a chat message — and
 * three things ride along invisibly, none of which survives contact with a search API.
 *
 * Format characters (`\p{Cf}`: the zero-width spaces, the soft hyphen, the bidi marks) have no
 * width and no meaning to a search index, and crucially they are *not* whitespace, so `trim()`
 * walks straight past them. `/api/search?q=%C2%AD` — one soft hyphen — passed validation and
 * fanned out to all six providers, which each answered with whatever their empty-query
 * behaviour happens to be; the page filled with unrelated songs.
 *
 * Interior runs of whitespace make the same question look like a different one: `/api/search`
 * keys its two-minute cache on the parsed text, so "daft  punk" and "daft punk" each searched
 * every provider and each cached the answer separately.
 *
 * And an accented name arrives composed or decomposed depending on where it was copied from —
 * Deezer sends "Björk" as one code point, macOS pastes it as two — which is two cache entries
 * and, upstream, two different result sets. NFKC settles that. It also folds the full-width
 * Latin a Japanese IME emits by default onto ASCII, and turns a non-breaking space into a
 * plain one, which is why it runs before the whitespace pass rather than after.
 */
const FORMAT_CHARACTERS = /\p{Cf}/gu;

const cleanQueryText = (value: unknown) =>
  typeof value === "string"
    ? value.normalize("NFKC").replace(FORMAT_CHARACTERS, "").replace(/\s+/g, " ").trim() ||
      undefined
    : value;

export const queryText = (max: number) => z.preprocess(cleanQueryText, z.string().max(max));

export const optionalQueryText = (max: number) =>
  z.preprocess(cleanQueryText, z.string().max(max).optional());

export const queryFlag = z
  .enum(["1", "true", "0", "false"])
  .optional()
  .transform((value) => value === "1" || value === "true");
