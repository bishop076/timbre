/**
 * The keyboard of a `role="menu"`, with no DOM in it — which index a key lands on, and nothing
 * about how it gets there. Split out from the hook below it for the same reason `a11y/roving.ts`
 * is split out: `node --test` can read this, and cannot read a `.tsx`.
 *
 * A menu differs from the shelves `rovingTarget` was written for in exactly one way, so that is
 * all this adds on top of it: a menu is a closed loop. Arrowing off the end of a shelf hands the
 * key back to the page so Tab can leave; arrowing off the end of a menu wraps, because a menu is
 * modal and there is nowhere else for the key to go.
 */
import { rovingTarget } from "../a11y/roving";

/**
 * How long a half-typed word survives. APG leaves the figure open; 500 ms is what a screen
 * reader's own list navigation uses, and short enough that a second, unrelated letter a moment
 * later reads as a fresh search rather than a two-letter one that matches nothing.
 */
export const TYPEAHEAD_MS = 500;

const OWNED = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);

/** Whitespace in a label comes from the markup, not the word: two spans on separate lines. */
function normalise(label: string): string {
  return label.replace(/\s+/gu, " ").trim().toLowerCase();
}

/**
 * Where Up, Down, Home or End goes. `null` means the key is not ours and must be left alone —
 * Left and Right belong to the page here, and to the caret when a menu holds a text field.
 *
 * `from` may be -1, meaning focus is on the menu itself rather than on any item. Down then opens
 * at the top and Up at the bottom, which is what a menu opened with the keyboard should do.
 */
export function menuTarget(key: string, from: number, count: number): number | null {
  if (count <= 0 || !OWNED.has(key)) return null;
  const at = from >= count ? -1 : from;
  return rovingTarget(key, at, count, "vertical") ?? (key === "ArrowDown" ? 0 : count - 1);
}

/**
 * The typeahead buffer after `key`, or `null` if the key is not one that types.
 *
 * Space is deliberately not a way to start a search: on a menu item it is a way to press it.
 * Once a word is under way it is an ordinary character again, so "add to" can be typed in full.
 */
export function typeaheadQuery(previous: string, key: string, sinceMs: number): string | null {
  if ([...key].length !== 1) return null;
  const carried = sinceMs <= TYPEAHEAD_MS ? previous : "";
  if (key === " " && carried === "") return null;
  return carried + key;
}

/**
 * The next item whose label starts with `query`, searching forward from `from` and wrapping.
 *
 * Two rules that are easy to miss and both of them are felt:
 *
 * - A single letter searches from the item *after* the current one, so pressing "p" twice in a
 *   menu of "Play now" and "Play next" steps between them instead of sticking on the first.
 * - A longer query searches from the current item itself, so typing "p", then "l" refines to
 *   "Playlists only" rather than skipping past the item the "p" just found.
 *
 * Repeating one letter ("ppp") is the first case, not the second: it is someone pressing the
 * same key again, not spelling a word.
 */
export function typeaheadTarget(query: string, labels: readonly string[], from: number): number | null {
  const typed = query.toLowerCase();
  if (typed === "" || labels.length === 0) return null;

  const repeated = [...typed].every((character) => character === typed[0]);
  const needle = repeated ? typed[0]! : typed;
  const start = needle.length === 1 || repeated ? from + 1 : from;

  for (let step = 0; step < labels.length; step += 1) {
    const index = (((start + step) % labels.length) + labels.length) % labels.length;
    if (normalise(labels[index] ?? "").startsWith(needle)) return index;
  }
  return null;
}

/**
 * Where Tab goes inside a menu that traps it. Wrapping is the trap: there is no index off either
 * end, so focus cannot leave by the one key whose whole job elsewhere is leaving.
 */
export function tabTarget(from: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return null;
  if (from < 0) return backwards ? count - 1 : 0;
  return (from + (backwards ? -1 : 1) + count) % count;
}
