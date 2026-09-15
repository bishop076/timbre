import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ImageResponse } from "next/og";

import { TimbreMark } from "./shell/brand";

export const alt = "Timbre — a music player for people who don't pay for streaming";

// 1200x400, not the conventional 1200x630. This is the same drawing as docs/assets/readme-banner.tsx
// at the same size, deliberately: the banner shape is the design, and re-flowing it into a 630-tall
// frame to satisfy the convention reads as a different picture — the sky opens up, the lockup drops
// away from the top edge, and the whole thing shrinks when it is scaled to fit. Unfurlers take it as
// given; a wide card is the point.
export const size = { width: 1200, height: 400 };
export const contentType = "image/png";

const CREAM = "#f3efe4";
const SUN = "#ffd9a8";
const SEA = "#1b1140";
const SEA_LINE_1 = "#4a34a8";
const SEA_LINE_2 = "#3d2a90";
const HORIZON = 278;

// The same lockup the README banner uses. "tim" is Delicious Handrawn, "bre" is Gluten at 0.94x,
// dropped 0.209 of the head size so the feet sit level — measured off rendered pixels, because
// Delicious sits high on its line and without the drop the "bre" hangs above the foot of the "m".
const BRE_SCALE = 0.94;
const BRE_DROP = 0.209;

// Four rows of ripples, alternating two violets so the sea is not a flat block.
const RIPPLES = [
  { x: 120, y: 316, w: 240, alt: false },
  { x: 420, y: 316, w: 160, alt: false },
  { x: 640, y: 316, w: 200, alt: false },
  { x: 60, y: 334, w: 300, alt: true },
  { x: 420, y: 334, w: 180, alt: true },
  { x: 660, y: 334, w: 260, alt: true },
  { x: 160, y: 354, w: 220, alt: false },
  { x: 440, y: 354, w: 300, alt: false },
  { x: 800, y: 354, w: 240, alt: false },
  { x: 80, y: 376, w: 340, alt: true },
  { x: 480, y: 376, w: 280, alt: true },
  { x: 820, y: 376, w: 300, alt: true },
];

// One literal `new URL(..., import.meta.url)` per face, never a template literal. Turbopack
// rewrites this form into a reference to a traced asset and can only do it statically, so
// `new URL(`./brand-fonts/${file}`, ...)` emits a single asset and hands every caller the same
// bytes — the first face it saw. Nothing warns, the build passes, and Satori falls back per glyph
// instead of throwing, so it renders a plausible image with two of the three families wrong.
// `new URL` rather than a path off process.cwd() because only what Next can trace from this route
// is copied into the serverless bundle, and a cwd read builds fine locally then 500s in
// production. Read rather than fetched: this route runs on the Node runtime, where `fetch` of a
// file: URL is "not implemented... yet".
const FONT_URLS = {
  head: new URL("./brand-fonts/DeliciousHandrawn.woff", import.meta.url),
  gluten: new URL("./brand-fonts/Gluten.woff", import.meta.url),
  outfit: new URL("./brand-fonts/Outfit.woff", import.meta.url),
};

const font = (url: URL) => readFileSync(fileURLToPath(url));

function Caption({ text, top }: { text: string; top: number }) {
  return (
    <span
      style={{
        fontFamily: "Outfit",
        fontSize: 22,
        letterSpacing: 1,
        color: "#e7dcff",
        position: "absolute",
        left: 98,
        top,
      }}
    >
      {text}
    </span>
  );
}

export default function OpenGraphImage() {
  const head = font(FONT_URLS.head);
  const gluten = font(FONT_URLS.gluten);
  const outfit = font(FONT_URLS.outfit);

  const size1 = 126;

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: 1200,
          height: 400,
          position: "relative",
          overflow: "hidden",
          background: "linear-gradient(180deg, #2a1a5c 0%, #5b3fd6 58%, #8f74ff 100%)",
        }}
      >
        <svg width={1200} height={400} viewBox="0 0 1200 400" style={{ position: "absolute", left: 0, top: 0 }}>
          <circle cx="900" cy="236" r="132" fill={SUN} />
          <rect x="0" y={HORIZON} width="1200" height={400 - HORIZON} fill={SEA} />
          <rect x="0" y={HORIZON} width="1200" height="2" fill="#6247c9" opacity="0.6" />
          {RIPPLES.map((l, i) => (
            <rect key={i} x={l.x} y={l.y} width={l.w} height="4" rx="2" fill={l.alt ? SEA_LINE_2 : SEA_LINE_1} />
          ))}
        </svg>

        <TimbreMark
          width={126}
          height={144}
          style={{ color: SEA, position: "absolute", left: 836, top: 138 }}
        />

        <div style={{ display: "flex", position: "absolute", left: 96, top: 96 }}>
          <div style={{ display: "flex", alignItems: "flex-start", flexShrink: 0 }}>
            <span style={{ fontFamily: "Head", fontSize: size1, letterSpacing: size1 * -0.02, color: CREAM, lineHeight: 1 }}>
              tim
            </span>
            <span
              style={{
                fontFamily: "Gluten",
                fontSize: size1 * BRE_SCALE,
                letterSpacing: -size1 * 0.012,
                color: CREAM,
                lineHeight: 1,
                marginLeft: size1 * 0.02,
                marginTop: size1 * BRE_DROP,
              }}
            >
              bre
            </span>
            <TimbreMark
              width={size1 * 0.3}
              height={size1 * 0.34}
              style={{ color: SUN, marginLeft: size1 * 0.05, alignSelf: "flex-start" }}
            />
          </div>
        </div>

        <Caption text="a music player for people" top={238} />
        <Caption text="who don't pay for streaming" top={268} />
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Head", data: head, weight: 400, style: "normal" },
        { name: "Gluten", data: gluten, weight: 400, style: "normal" },
        { name: "Outfit", data: outfit, weight: 400, style: "normal" },
      ],
    },
  );
}
