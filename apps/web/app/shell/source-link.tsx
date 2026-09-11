"use client";

import { useEffect, useRef, useState } from "react";

import { SOURCE_TAG, SOURCE_TAG_ACTIVE, sourceTone } from "../source-tag";
import { sourceStyle } from "../sources";
import type { Song } from "../types";

export function SourceLink({
  song,
  activeSource,
  label,
  className,
}: {
  song: Song;
  activeSource: string | null;
  label: string;
  className: string;
}) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const source = activeSource ?? "ytmusic";
  const url = song.sources.find((entry) => entry.source === activeSource)?.url ?? null;
  const badge = `${SOURCE_TAG} shrink-0 ${className}`;

  if (!url) return <span className={badge}>{label}</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedUrl(null), 1600);
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy the ${sourceStyle(source).label} link for ${song.title}`}
      title={`Copy the ${sourceStyle(source).label} link`}
      className={`${badge} ${SOURCE_TAG_ACTIVE} cursor-pointer`}
      style={sourceTone(source)}
    >
      <span aria-live="polite">{copiedUrl === url ? "Copied" : label}</span>
    </button>
  );
}
