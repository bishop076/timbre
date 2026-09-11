export interface ProfileExport {
  name: string | null;
  avatar: string | null;
  banner: string | null;
}

const IMAGE_DATA = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

const MAX_IMAGE_CHARS = 7 * 1024 * 1024;

const MAX_NAME_CHARS = 256;

function image(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_IMAGE_CHARS && IMAGE_DATA.test(value) ? value : null;
}

export function readProfileExport(value: unknown): ProfileExport | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.slice(0, MAX_NAME_CHARS) : null;
  const profile = { name, avatar: image(raw.avatar), banner: image(raw.banner) };
  return profile.name || profile.avatar || profile.banner ? profile : null;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const type = dataUrl.slice(5, dataUrl.indexOf(";"));
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}
