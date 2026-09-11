/**
 * The profile as it travels in an export: a name and two pictures, the pictures as data URLs
 * because a JSON file has nowhere else to put bytes.
 *
 * Kept apart from the code that reads and writes the browser's copy so the part that judges
 * a file — the part a stranger's file reaches — can be tested without one.
 */

export interface ProfileExport {
  name: string | null;
  avatar: string | null;
  banner: string | null;
}

/** What an image in a backup may be: the types the picker accepts, and nothing that decodes
 * as markup. SVG in particular is refused — it is a document, not a picture. */
const IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** Past this a "picture" is not one Timbre wrote: stored copies are resized to 512px (avatar)
 * and a banner's width, well under a megabyte each. The margin is for a GIF avatar, which is
 * kept as-is up to 5MB — base64 adds a third. */
const MAX_IMAGE_CHARS = 7 * 1024 * 1024;

/** Anything longer is not a display name; `setDisplayName` trims to 64 anyway. */
const MAX_NAME_CHARS = 256;

function image(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_IMAGE_CHARS && IMAGE_DATA.test(value) ? value : null;
}

/** The profile in an export file, or `null` when it carries none worth applying. */
export function readProfileExport(value: unknown): ProfileExport | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.slice(0, MAX_NAME_CHARS) : null;
  const profile = { name, avatar: image(raw.avatar), banner: image(raw.banner) };
  return profile.name || profile.avatar || profile.banner ? profile : null;
}

/** A data URL's bytes, for handing back to the same resize path a picked file takes. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const type = dataUrl.slice(5, dataUrl.indexOf(";"));
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}
