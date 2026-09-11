"use client";

import { useEffect, useState } from "react";

import { sampleHue, type Hsl } from "../hue";

export interface Sample {
  color: Hsl | null;
  settled: boolean;
}

export function useDominantColor(src: string | null): Sample {
  const [found, setFound] = useState<{ src: string; color: Hsl | null } | null>(null);

  useEffect(() => {
    if (!src) return;
    return sampleHue(src, (color) => setFound({ src, color }));
  }, [src]);

  if (!src) return { color: null, settled: true };

  return { color: found?.color ?? null, settled: found?.src === src };
}
