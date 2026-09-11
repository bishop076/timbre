"use client";

import { sourceStyle } from "./sources";

export const SOURCE_TAG = "text-[11px] text-[var(--fg-faint)] transition-colors";

export const SOURCE_TAG_ACTIVE = "hover:text-[var(--tone)]";

export function sourceTone(source: string): Record<string, string> {
  return { "--tone": sourceStyle(source).color };
}

export function SourceTag({ source, className = "" }: { source: string; className?: string }) {
  return <span className={`${SOURCE_TAG} shrink-0 ${className}`}>{sourceStyle(source).short}</span>;
}
