import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ImageResponse } from "next/og";

import { TimbreMark } from "./shell/brand";

export const alt = "Timbre — all your music, one search";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0c0b10";
const CREAM = "#f3efe4";
const VIOLET = "#7c5cf6";
const PALM = "#2f6b46";

// The same lockup the README banner uses. "tim" is Delicious Handrawn, "bre" is Gluten at 0.94x,
// dropped 0.209 of the head size so the feet sit level — measured off rendered pixels, because
// Delicious sits high on its line and without the drop the "bre" hangs above the foot of the "m".
const BRE_SCALE = 0.94;
const BRE_DROP = 0.209;

// `new URL(..., import.meta.url)` rather than a path off process.cwd(): only what Next can trace
// from this route is copied into the serverless bundle, and a cwd read builds fine locally then
// 500s in production. It is read rather than fetched because this route runs on the Node runtime,
// where `fetch` of a file: URL is "not implemented... yet".
const font = (file: string) =>
  readFileSync(fileURLToPath(new URL(`./brand-fonts/${file}`, import.meta.url)));

export default function OpenGraphImage() {
  const head = font("DeliciousHandrawn.woff");
  const gluten = font("Gluten.woff");
  const outfit = font("Outfit.woff");

  const size1 = 148;
  const grooves = [232, 208, 184, 160];

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          background: CREAM,
        }}
      >
        <svg width={1200} height={630} viewBox="0 0 1200 630" style={{ position: "absolute", left: 0, top: 0 }}>
          <circle cx="836" cy="452" r="262" fill={INK} />
          {grooves.map((r) => (
            <circle key={r} cx="836" cy="452" r={r} fill="none" stroke="#2b2539" strokeWidth="3" />
          ))}
          <circle cx="836" cy="452" r="86" fill={VIOLET} />
          <circle cx="836" cy="452" r="9" fill={INK} />
          <rect x="556" y="112" width="13" height="50" rx="6" fill={VIOLET} opacity="0.5" />
          <rect x="620" y="82" width="13" height="80" rx="6" fill={VIOLET} opacity="0.7" />
          <rect x="684" y="120" width="13" height="42" rx="6" fill={VIOLET} opacity="0.45" />
        </svg>

        <TimbreMark
          width={268}
          height={306}
          style={{ color: PALM, position: "absolute", left: 702, top: 158 }}
        />

        <div style={{ display: "flex", alignItems: "flex-start", position: "absolute", left: 96, top: 214 }}>
          <span style={{ fontFamily: "Head", fontSize: size1, letterSpacing: size1 * -0.02, color: INK, lineHeight: 1 }}>
            tim
          </span>
          <span
            style={{
              fontFamily: "Gluten",
              fontSize: size1 * BRE_SCALE,
              letterSpacing: -size1 * 0.012,
              color: INK,
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
            style={{ color: VIOLET, marginLeft: size1 * 0.05, alignSelf: "flex-start" }}
          />
        </div>

        <span
          style={{
            fontFamily: "Outfit",
            fontSize: 30,
            letterSpacing: 3,
            color: "#5d5674",
            position: "absolute",
            left: 98,
            top: 400,
          }}
        >
          one search box, one queue
        </span>
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
