"use client";

/**
 * The typeface side of customisation: seven built-in choices and one the reader supplies.
 *
 * Two rules hold the whole file up.
 *
 * Every stack ends in the system fallback. A font can fail for reasons the reader will never
 * see — a file this browser cannot parse, a family name that does not match what is inside the
 * file, storage that was cleared — and the failure mode of a font-family with nothing after it
 * is an app rendered in the browser's last-resort serif, or in nothing at all while a webfont
 * that is never coming is awaited. Appending the fallback costs nothing and removes that.
 *
 * An uploaded font is read back as a data: URL rather than a blob: one. Not a preference: this
 * app's Content-Security-Policy says `font-src 'self' data:`, and a blob: URL is refused by it.
 * If that directive ever gains blob:, `load` can drop the base64 round trip.
 */

import { openImageStore } from "../profile/image-store.ts";
import { setVars } from "./theme-css.ts";

/** Appended to every stack, built-in or not. The app stays readable whatever else fails. */
export const FALLBACK = `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

export const FONTS = [
  {
    id: "default",
    label: "Timbre",
    note: "The app's own face.",
    stack: null,
  },
  {
    id: "system",
    label: "System",
    note: "Whatever this device uses everywhere else.",
    stack: FALLBACK,
  },
  {
    id: "serif",
    label: "Serif",
    note: "Quieter, and easier on a long page of lyrics.",
    stack: `Georgia, "Iowan Old Style", "Times New Roman", Times, serif`,
  },
  {
    id: "rounded",
    label: "Rounded",
    note: "Rounded letterforms.",
    stack: `ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", "Nunito", ${FALLBACK}`,
  },
  {
    id: "mono",
    label: "Monospace",
    note: "Every character the same width.",
    stack: `ui-monospace, SFMono-Regular, "Cascadia Mono", Consolas, monospace`,
  },
  {
    id: "legible",
    label: "High legibility",
    note: "Wide, open letterforms.",
    stack: `"Atkinson Hyperlegible", "Lexend", Verdana, Tahoma, ${FALLBACK}`,
  },
  {
    id: "dyslexic",
    label: "Dyslexia-friendly",
    note: "Letters that are harder to mistake for one another.",
    stack: `OpenDyslexic, "Comic Sans MS", "Comic Neue", Verdana, ${FALLBACK}`,
  },
  {
    id: "custom",
    label: "Your own font",
    note: "A file from this device.",
    stack: null,
  },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const FONT_IDS = FONTS.map((font) => font.id);

export function isFontId(value: unknown): value is FontId {
  return typeof value === "string" && FONT_IDS.some((id) => id === value);
}

/** A family name is written into a CSS declaration, so it may only be letters and spaces. */
export const cleanFamily = (name: string) =>
  name
    .replace(/[^\w \-]/g, "")
    .trim()
    .slice(0, 48);

/**
 * The value for --font-ui, or null to leave the app's own face alone.
 *
 * A custom family is quoted and then followed by the fallback, so the moment the uploaded file
 * fails to load the text is still set in something.
 */
export function fontStack(id: FontId, family = ""): string | null {
  if (id === "custom") {
    const clean = cleanFamily(family);
    return clean ? `"${clean}", ${FALLBACK}` : null;
  }
  return FONTS.find((font) => font.id === id)?.stack ?? null;
}

/* ------------------------------------------------------------------ the uploaded file */

const KEY = "theme-font";
const MAX_BYTES = 5 * 1024 * 1024;
const EXTENSIONS = /\.(woff2?|ttf|otf)$/i;

export const ACCEPT = ".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf";

async function store<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return openImageStore(mode, work);
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("That file could not be read."));
    reader.readAsDataURL(blob);
  });
}

let loaded: string | null = null;

/** Registers the stored font with the document. Cheap and idempotent after the first call. */
export async function loadCustomFont(family: string): Promise<boolean> {
  const clean = cleanFamily(family);
  if (!clean || typeof document === "undefined" || !("FontFace" in window)) return false;
  if (loaded === clean) return true;

  try {
    const blob = await store<Blob | undefined>("readonly", (table) => table.get(KEY));
    if (!blob) return false;

    const face = new FontFace(clean, `url(${JSON.stringify(await dataUrl(blob))})`, {
      display: "swap",
    });
    await face.load();
    document.fonts.add(face);
    loaded = clean;
    return true;
  } catch {
    // Deliberately quiet, and deliberately still readable: --font-ui already names the fallback
    // after the family, so text is set in the system face rather than in nothing.
    return false;
  }
}

/**
 * Takes a font file from the reader, keeps it in this browser, and returns the family name the
 * theme should store. Throws with something worth showing if the file is no good.
 */
export async function setCustomFont(file: File): Promise<string> {
  if (file.size > MAX_BYTES) {
    throw new Error("That font file is too large — fonts have to be under 5MB.");
  }
  if (!EXTENSIONS.test(file.name) && !/^font\//.test(file.type)) {
    throw new Error("That has to be a .woff2, .woff, .ttf or .otf file.");
  }

  const family = cleanFamily(file.name.replace(EXTENSIONS, "").replace(/[-_]+/g, " ")) || "Custom";

  // Parsed before it is stored: an unreadable file that reached storage would leave the reader
  // with a font choice that silently does nothing on every future load.
  const face = new FontFace(family, `url(${JSON.stringify(await dataUrl(file))})`, {
    display: "swap",
  });
  try {
    await face.load();
  } catch {
    throw new Error("This browser couldn't read that font file.");
  }

  try {
    await store("readwrite", (table) => table.put(file, KEY));
  } catch (cause) {
    throw new Error(
      cause instanceof DOMException && cause.name === "QuotaExceededError"
        ? "This browser is out of storage. Remove a picture or some playlists."
        : "Couldn't keep that font in this browser.",
    );
  }

  document.fonts.add(face);
  loaded = family;
  // The name is the only thing worth remembering, and the theme already remembers it: it goes
  // back to the caller, which stores it as `font.family`. A second copy in its own key would be
  // a second thing that can disagree with the first.
  return family;
}

export function clearCustomFont(): void {
  loaded = null;
  void store("readwrite", (table) => table.delete(KEY)).catch(() => {});
}

/** Points --font-ui at the chosen stack, and loads the uploaded file if that is the choice. */
export function applyFont(id: FontId, family: string): void {
  setVars({ "--font-ui": fontStack(id, family) });
  if (id === "custom") void loadCustomFont(family);
}
