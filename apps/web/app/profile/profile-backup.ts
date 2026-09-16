"use client";

import { dataUrlToBlob, type ProfileExport } from "./profile-file";
import { readLocalImage, setLocalImage, type ImageKind } from "./local-images";
import { getDisplayName, setDisplayName } from "./local-profile";

async function picture(kind: ImageKind): Promise<string | null> {
  const blob = await readLocalImage(kind);
  if (!blob) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });
}

export async function exportProfile(): Promise<ProfileExport | null> {
  const [avatar, banner] = await Promise.all([picture("avatar"), picture("banner")]);
  const name = getDisplayName();
  return name || avatar || banner ? { name, avatar, banner } : null;
}

/**
 * Whether this browser already has a profile of its own.
 *
 * This is the flag `library-view.tsx` reads to decide whether the profile inside a backup
 * replaces the local one **without asking**, so it has to be right about the pictures. It asked
 * `hasLocalImage`, which answered from the thumbnail in `localStorage` — and the thumbnail is a
 * painting of the picture rather than the picture, which lives in IndexedDB. A `localStorage`
 * with no room left is precisely the case where the two disagree: `setLocalImage` stores the
 * picture, `writeThumb` cannot store its copy and says so in the log, and from then on this
 * answered "no profile here". The next backup imported then handed someone else's avatar and
 * name over yours with nothing asked and no undo anywhere. Ask the store that holds the picture.
 */
export async function hasLocalProfile(): Promise<boolean> {
  if (getDisplayName()) return true;
  const [avatar, banner] = await Promise.all([readLocalImage("avatar"), readLocalImage("banner")]);
  return Boolean(avatar ?? banner);
}

/**
 * Applies the fields a backup actually carries, and returns their names.
 *
 * It has always merged rather than replaced — a file taken before a name was set leaves the
 * current name standing, and one with only an avatar leaves the current banner — but the only
 * caller announced "Profile replaced with the one from the file." regardless, so a partial
 * restore produced a hybrid profile and said otherwise. Returning what was set lets the notice
 * be true.
 */
export async function applyProfile(profile: ProfileExport): Promise<(keyof ProfileExport)[]> {
  const applied: (keyof ProfileExport)[] = [];
  // `setDisplayName` answers now, and the answer belongs here: this list is what the notice in
  // library-view.tsx reads out, and a browser that refused the write would otherwise be told its
  // name had been replaced by one that is not stored anywhere.
  if (profile.name && setDisplayName(profile.name)) applied.push("name");

  let refused: unknown = null;
  for (const kind of ["avatar", "banner"] as const) {
    const data = profile[kind];
    if (!data) continue;
    try {
      const blob = dataUrlToBlob(data);
      await setLocalImage(kind, new File([blob], kind, { type: blob.type }));
      applied.push(kind);
    } catch (cause) {
      refused ??= cause;
    }
  }
  if (refused) throw refused;
  return applied;
}
