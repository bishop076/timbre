export interface Hsl {
  h: number;
  s: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

const BUCKETS = 24;
const SIZE = 48;

function dominantHue(data: Uint8ClampedArray): Hsl | null {
  const buckets = Array.from({ length: BUCKETS }, () => ({ weight: 0, sin: 0, cos: 0, sat: 0 }));

  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3] < 128) continue;

    const [h, s, l] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    if (s < 0.18 || l < 0.12 || l > 0.92) continue;

    const score = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score <= 0) continue;

    const bucket = buckets[Math.min(BUCKETS - 1, Math.floor(h * BUCKETS))];
    const angle = h * Math.PI * 2;
    bucket.weight += score;
    bucket.sin += Math.sin(angle) * score;
    bucket.cos += Math.cos(angle) * score;
    bucket.sat += s * score;
  }

  const around = (i: number) =>
    [-1, 0, 1].map((offset) => buckets[(i + offset + BUCKETS) % BUCKETS]);
  const sum = (list: typeof buckets, key: keyof (typeof buckets)[number]) =>
    list.reduce((total, bucket) => total + bucket[key], 0);

  const totals = buckets.map((_, i) => sum(around(i), "weight"));
  const bestWeight = Math.max(...totals);
  if (bestWeight === 0) return null;

  const best = totals.indexOf(bestWeight);
  const chosen = around(best).filter((bucket) => bucket.weight >= buckets[best].weight * 0.5);
  const angle = Math.atan2(sum(chosen, "sin"), sum(chosen, "cos"));
  return { h: (angle / (Math.PI * 2) + 1) % 1, s: sum(chosen, "sat") / sum(chosen, "weight") };
}

function readPixels(image: HTMLImageElement): Hsl | null {
  try {
    const canvas = Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, SIZE, SIZE);
    return dominantHue(context.getImageData(0, 0, SIZE, SIZE).data);
  } catch {
    return null;
  }
}

export function sampleHue(src: string, report: (color: Hsl | null) => void): () => void {
  let cancelled = false;
  const image = new Image();
  if (/^https?:/.test(src)) image.crossOrigin = "anonymous";

  image.onload = () => {
    if (!cancelled) report(readPixels(image));
  };
  image.onerror = () => {
    if (!cancelled) report(null);
  };
  image.src = src;

  return () => {
    cancelled = true;
  };
}
