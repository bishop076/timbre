import { sourceStyle } from "./sources";

export const SOURCE_TAG = "text-[11px] text-[var(--fg-faint)] transition-colors";

export const SOURCE_TAG_ACTIVE = "hover:text-[var(--tone)]";

export function sourceTone(source: string): Record<string, string> {
  return { "--tone": sourceStyle(source).color };
}
