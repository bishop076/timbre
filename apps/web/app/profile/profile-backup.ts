"use client";

import { dataUrlToBlob, type ProfileExport } from "./profile-file";
import { hasLocalImage, readLocalImage, setLocalImage, type ImageKind } from "./local-images";
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

export function hasLocalProfile(): boolean {
  return Boolean(getDisplayName()) || hasLocalImage("avatar") || hasLocalImage("banner");
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
  if (profile.name) {
    setDisplayName(profile.name);
    applied.push("name");
  }

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
