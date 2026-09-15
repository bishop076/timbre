/**
 * The last few colours the reader picked for themselves, kept so they can get back to one.
 *
 * Only colours chosen through the picker — the wheel or the text field — land here. Tapping a
 * preset does not: the preset is still sitting one row up, so recording it would spend a slot
 * on a swatch that is already on screen, and three slots is not enough to waste one. That is
 * also why a *typed* colour that happens to match a preset is dropped on the way in.
 *
 * Pure apart from the store itself, so the rules are testable under `node --test`.
 */

import { createJsonStore, useLocalStore } from "../local-store.ts";
import { normaliseHex } from "./color.ts";
import { PRESETS } from "./custom-theme.ts";

export const ACCENT_HISTORY_KEY = "timbre:accents";

/** Three, and three on the way in as well as on the way out. See `parseAccentHistory`. */
export const ACCENT_HISTORY_LIMIT = 3;

const EMPTY: string[] = [];

const isPreset = (hex: string) => PRESETS.some((preset) => preset.hex === hex);

/**
 * The stored list, under the same rules the write path applies: at most three entries, no
 * repeats, and every one of them a real `#rrggbb`.
 *
 * Enforcing a cap only where the list is written has been the same bug four times over in this
 * app — the played history, the taste book, the lyrics preferences and the source choices all
 * sliced on the way out and took back whatever they found. A second tab on an older build, a
 * hand-edited key, or a half-written value is enough, and a bound only the writer honours is
 * not a bound. Anything unreadable is skipped rather than truncating the list at it, so one bad
 * entry costs one swatch and not the other two.
 */
export function parseAccentHistory(stored: unknown): string[] {
  if (!Array.isArray(stored)) return EMPTY;

  const colours: string[] = [];
  for (const value of stored) {
    if (colours.length >= ACCENT_HISTORY_LIMIT) break;
    if (typeof value !== "string") continue;
    const hex = normaliseHex(value);
    if (!hex || colours.includes(hex)) continue;
    colours.push(hex);
  }
  return colours.length > 0 ? colours : EMPTY;
}

const store = createJsonStore(ACCENT_HISTORY_KEY, EMPTY, parseAccentHistory);

export const getAccentHistory = store.getSnapshot;

export function useAccentHistory(): string[] {
  return useLocalStore(store);
}

/**
 * Records a colour the reader picked. Newest first, no repeats, three at most.
 *
 * Deliberately not called from the preset swatches or from the drift in "cycling" — neither is
 * somebody choosing a colour, and a list that fills itself is not a history of anything.
 */
export function rememberAccent(input: string): void {
  const hex = normaliseHex(input);
  if (!hex || isPreset(hex)) return;

  const current = getAccentHistory();
  if (current[0] === hex) return;
  store.save([hex, ...current.filter((colour) => colour !== hex)].slice(0, ACCENT_HISTORY_LIMIT));
}
