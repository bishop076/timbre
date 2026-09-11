"use client";

import { useEffect, useRef, useState } from "react";

import type { Song } from "../types";
import { sourceStyle } from "../sources";
import { SOURCE_TAG, SOURCE_TAG_ACTIVE, sourceTone } from "../source-tag";

const COPIED_MS = 1600;

export function SourceLink({
  song,
  activeSource,
  label,
  className = "",
}: {
  song: Song | null;
  activeSource: string | null;
  label: string;
  className?: string;
}) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const style = sourceStyle(activeSource ?? "ytmusic");
  const url = song?.sources.find((entry) => entry.source === activeSource)?.url ?? null;
  const copied = url !== null && copiedUrl === url;

  const badge = `${SOURCE_TAG} shrink-0 ${className}`;
  const paint = sourceTone(activeSource ?? "ytmusic");

  if (!url) return <span className={badge}>{label}</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopiedUrl(url);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedUrl(null), COPIED_MS);
    } catch {
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy the ${style.label} link for ${song?.title ?? "this song"}`}
      title={`Copy the ${style.label} link`}
      className={`${badge} ${SOURCE_TAG_ACTIVE} cursor-pointer`}
      style={paint}
    >
      <span aria-live="polite">{copied ? "Copied" : label}</span>
    </button>
  );
}
