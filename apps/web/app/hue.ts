export interface Hsl {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

const BUCKETS = 24;

const WINDOW = 1;

function dominantHue(data: Uint8ClampedArray): Hsl | null {
  const weight = new Float64Array(BUCKETS);
  const sinSum = new Float64Array(BUCKETS);
  const cosSum = new Float64Array(BUCKETS);
  const satSum = new Float64Array(BUCKETS);
  const litSum = new Float64Array(BUCKETS);

  for (let i = 0; i < data.length; i += 16) {
    if (data[i + 3]! < 128) continue;

    const [h, s, l] = rgbToHsl(data[i]!, data[i + 1]!, data[i + 2]!);

    if (s < 0.18 || l < 0.12 || l > 0.92) continue;

    const score = s * s * (1 - Math.abs(l - 0.5) * 1.4);
    if (score <= 0) continue;

    const bucket = Math.min(BUCKETS - 1, Math.floor(h * BUCKETS));
    const angle = h * Math.PI * 2;
    weight[bucket]! += score;
    sinSum[bucket]! += Math.sin(angle) * score;
    cosSum[bucket]! += Math.cos(angle) * score;
    satSum[bucket]! += s * score;
    litSum[bucket]! += l * score;
  }

  let best = -1;
  let bestWeight = 0;
  for (let i = 0; i < BUCKETS; i++) {
    let total = 0;
    for (let offset = -WINDOW; offset <= WINDOW; offset++) {
      total += weight[(i + offset + BUCKETS) % BUCKETS]!;
    }
    if (total > bestWeight) {
      bestWeight = total;
      best = i;
    }
  }
  if (best < 0 || bestWeight === 0) return null;

  const peak = weight[best]!;
  let sin = 0;
  let cos = 0;
  let sat = 0;
  let lit = 0;
  let total = 0;
  for (let offset = -WINDOW; offset <= WINDOW; offset++) {
    const bucket = (best + offset + BUCKETS) % BUCKETS;
    if (offset !== 0 && weight[bucket]! < peak * 0.5) continue;
    sin += sinSum[bucket]!;
    cos += cosSum[bucket]!;
    sat += satSum[bucket]!;
    lit += litSum[bucket]!;
    total += weight[bucket]!;
  }

  const angle = Math.atan2(sin / total, cos / total);

  return {
    h: (((angle / (Math.PI * 2)) % 1) + 1) % 1,
    s: sat / total,
    l: lit / total,
  };
}

const SIZE = 48;

function readPixels(image: HTMLImageElement): Hsl | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
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
