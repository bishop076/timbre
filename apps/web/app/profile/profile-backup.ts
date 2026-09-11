"use client";

/**
 * The profile, into and out of a backup file.
 *
 * Export used to carry playlists only, so clearing site data lost the name and both
 * pictures with no way to have kept them. What held this back was a decision rather than
 * code: whether importing onto a browser that already has a profile overwrites it. The
 * answer here is the one playlists already give — **an import never silently overwrites.**
 * An empty profile is filled in, since there is nothing to lose; one that exists is left
 * alone and the reader is offered the file's instead, by name, with a button.
 */

import { dataUrlToBlob, type ProfileExport } from "./profile-file";
import { hasLocalImage, readLocalImage, setLocalImage, type ImageKind } from "./local-images";
import { getDisplayName, setDisplayName } from "./local-profile";

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function picture(kind: ImageKind): Promise<string | null> {
  const blob = await readLocalImage(kind);
  if (!blob) return null;
  try {
    return await toDataUrl(blob);
  } catch {
    return null;
  }
}

/** This browser's profile, ready for a file — or `null` when there is nothing in it. */
export async function exportProfile(): Promise<ProfileExport | null> {
  const [avatar, banner] = await Promise.all([picture("avatar"), picture("banner")]);
  const name = getDisplayName();
  return name || avatar || banner ? { name, avatar, banner } : null;
}

/** Whether there is anything here an import could overwrite. */
export function hasLocalProfile(): boolean {
  return Boolean(getDisplayName()) || hasLocalImage("avatar") || hasLocalImage("banner");
}

/**
 * Puts a backed-up profile on this browser. The pictures go through `setLocalImage`, the
 * same path a picked file takes, so they are re-validated and re-sized rather than trusted
 * because they arrived in a Timbre-shaped file. Throws the picker's own error if one is
 * refused, after applying whatever did succeed.
 */
export async function applyProfile(profile: ProfileExport): Promise<void> {
  if (profile.name) setDisplayName(profile.name);

  let refused: unknown = null;
  for (const kind of ["avatar", "banner"] as const) {
    const data = profile[kind];
    if (!data) continue;
    try {
      const blob = dataUrlToBlob(data);
      await setLocalImage(kind, new File([blob], kind, { type: blob.type }));
    } catch (cause) {
      refused ??= cause;
    }
  }
  if (refused) throw refused;
}
