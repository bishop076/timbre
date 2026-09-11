export interface ProfileExport {
  name: string | null;
  avatar: string | null;
  banner: string | null;
}

const IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

function image(value: unknown): string | null {
  const ok = typeof value === "string" && value.length <= 7 * 1024 * 1024 && IMAGE_DATA.test(value);
  return ok ? value : null;
}

export function readProfileExport(value: unknown): ProfileExport | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.slice(0, 256) : null;
  const profile = { name, avatar: image(raw.avatar), banner: image(raw.banner) };
  return profile.name || profile.avatar || profile.banner ? profile : null;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: dataUrl.slice(5, dataUrl.indexOf(";")) });
}
