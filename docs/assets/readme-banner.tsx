// Source for docs/assets/readme-banner.png. Not routed, not built, not imported by the app —
// it lives here so the banner is an edit rather than a redesign next time. The previous banner
// was a PNG with no source, which is why replacing it took a day.
//
// To redraw it:
//   1. cp docs/assets/readme-banner.tsx apps/web/app/banner-preview/route.tsx
//   2. cd apps/web && TIMBRE_DIST_DIR=.next-banner npx next dev -p 3249
//   3. curl -o ../../docs/assets/readme-banner.png http://localhost:3249/banner-preview
//   4. rm -r apps/web/app/banner-preview apps/web/.next-banner
//      and `git checkout -- apps/web/tsconfig.json` — next dev rewrites it
//
// Step 4 matters: left in place this is a public endpoint on the deployment.
//
// It has to run inside Next because `next/og` is Satori plus resvg wired together by Next and
// does not resolve standalone. Two of its limits are load-bearing here, both found the hard way:
// a component or fragment returning <svg> children renders as nothing, and `url(#id)` gradient
// references do not resolve. So every shape is inline and every fill is a flat colour.

import { readFileSync } from "node:fs";
import path from "node:path";

import { ImageResponse } from "next/og";

// Resolved from apps/web, which is where `next dev` runs.
const FONTS = path.join(process.cwd(), "../../docs/assets/fonts");
const load = (file: string) => readFileSync(path.join(FONTS, file));

// The palm, inlined rather than imported from app/shell/brand so this file resolves wherever it
// sits. If the mark changes there, copy the path across.
const MARK_D =
  "M243.615 78.7253C220.468 66.2067 195.76 57.5623 170.443 52.8208C167.377 52.2426 166.769 48.1372 169.518 46.6917C187.861 37.122 207.593 29.981 228.28 25.7021C231.781 24.9793 234.125 21.6545 233.517 18.1274L231.26 5.40644C230.595 1.7058 227.094 -0.607097 223.391 0.144595C187.514 7.48804 154.183 22.5219 125.337 43.5981C124.18 44.4366 122.675 44.4366 121.518 43.5981C92.7297 22.5219 59.399 7.48804 23.5223 0.144595C19.8478 -0.607097 16.318 1.7058 15.6525 5.40644L13.3958 18.1274C12.7592 21.6545 15.1028 24.9793 18.6326 25.7021C39.3196 29.981 59.0518 37.0931 77.3953 46.6917C80.1439 48.1372 79.5363 52.2426 76.4694 52.8208C51.1821 57.5912 26.4734 66.2067 3.35605 78.7542C0.144503 80.4889 -0.954946 84.5943 0.867825 87.7456L7.31986 98.9342C9.1137 102.028 13.0486 103.069 16.2023 101.392C35.9634 90.7523 56.9687 83.2643 78.4658 78.9277C81.5038 78.3205 83.6448 81.8766 81.6195 84.2473C64.0572 104.948 49.7065 128.568 39.4932 154.415C38.1334 157.826 39.9272 161.672 43.3702 162.915L55.4931 167.338C58.8493 168.552 62.5527 166.847 63.8547 163.522C73.4315 139.497 86.9721 117.611 103.608 98.5873C105.663 96.2455 109.54 97.8067 109.395 100.9C106.849 152.131 99.3553 202.841 87.0589 252.279C86.5091 254.477 84.5128 256.009 82.256 256.009H6.5676C2.95099 256.009 -0.000161202 258.958 -0.000161202 262.572V275.466C-0.000161202 279.08 2.95099 282.029 6.5676 282.029H240.432C244.049 282.029 247 279.08 247 275.466V262.572C247 258.958 244.049 256.009 240.432 256.009H117.178C115.066 256.009 113.504 254.043 113.995 251.99C126.031 201.8 133.294 150.396 135.637 98.5005C135.782 95.5516 139.398 94.2506 141.366 96.4768C158.87 115.992 173.076 138.6 183 163.522C184.331 166.847 188.006 168.581 191.362 167.338L203.514 162.915C206.957 161.672 208.751 157.826 207.391 154.415C197.177 128.568 182.827 104.948 165.264 84.2473C163.239 81.8766 165.38 78.2916 168.418 78.9277C189.944 83.2643 210.978 90.7523 230.768 101.392C233.922 103.097 237.857 102.057 239.651 98.9342L246.103 87.7456C247.926 84.5653 246.826 80.4889 243.615 78.7542V78.7253Z";

function TimbreMark(props: { width: number; height: number; style: Record<string, unknown> }) {
  return (
    <svg viewBox="0 0 247 282" fill="none" width={props.width} height={props.height} style={props.style}>
      <path d={MARK_D} fill="currentColor" />
    </svg>
  );
}

const W = 1200;
const H = 400;

const INK = "#0c0b10";
const CREAM = "#f3efe4";
const VIOLET = "#7c5cf6";
const LILAC = "#a78bfa";
const SUN = "#ffd9a8";

// "tim" is Delicious Handrawn, "bre" is Gluten at 0.94x. Both numbers are measured off the
// rendered pixels rather than judged: Delicious sits high on its line, so without the drop the
// "bre" hangs 13px above the foot of the "m". 0.209 puts the feet level, with the round b and e
// 2px past it — the overshoot round letters are supposed to have. Change the scale and the drop
// has to move with it; the relationship is linear at about 11px per 0.1 at this size.
const HEAD_TRACK = -0.02;
const BRE_SCALE = 0.94;
const BRE_DROP = 0.209;

function Lockup({ size, color, mark }: { size: number; color: string; mark: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", flexShrink: 0 }}>
      <span style={{ fontFamily: "Head", fontSize: size, letterSpacing: size * HEAD_TRACK, color, lineHeight: 1 }}>
        tim
      </span>
      <span
        style={{
          fontFamily: "Gluten",
          fontSize: size * BRE_SCALE,
          letterSpacing: -size * 0.012,
          color,
          lineHeight: 1,
          marginLeft: size * 0.02,
          marginTop: size * BRE_DROP,
        }}
      >
        bre
      </span>
      <TimbreMark
        width={size * 0.3}
        height={size * 0.34}
        style={{ color: mark, marginLeft: size * 0.05, alignSelf: "flex-start" }}
      />
    </div>
  );
}

// A deck seen from above, the cream side carrying the name and the black side the record.
export function GET() {
  const grooves = [136, 122, 108, 94];

  return new ImageResponse(
    (
      <div style={{ display: "flex", width: W, height: H, background: "#efe7d6", position: "relative", overflow: "hidden" }}>
        <svg width={W} height={H} viewBox="0 0 1200 400" style={{ position: "absolute", left: 0, top: 0 }}>
          <rect x="560" y="-30" width="640" height="460" rx="24" fill={INK} />
          <circle cx="820" cy="200" r="168" fill="#1f1a2c" />
          <circle cx="820" cy="200" r="150" fill="#100d18" />
          {grooves.map((r) => (
            <circle key={r} cx="820" cy="200" r={r} fill="none" stroke="#2b2539" strokeWidth="2" />
          ))}
          <circle cx="820" cy="200" r="52" fill={VIOLET} />
          <circle cx="820" cy="200" r="6" fill="#100d18" />
          <circle cx="1092" cy="92" r="30" fill="#2b2539" />
          <rect x="1076" y="104" width="14" height="150" rx="7" fill="#3a3350" transform="rotate(22 1083 179)" />
          <rect x="1016" y="240" width="44" height="18" rx="6" fill={CREAM} transform="rotate(22 1038 249)" />
          <circle cx="632" cy="330" r="26" fill="#2b2539" />
          <rect x="626" y="306" width="12" height="20" rx="6" fill={LILAC} />
          <rect x="690" y="318" width="150" height="12" rx="6" fill="#2b2539" />
          <rect x="690" y="318" width="92" height="12" rx="6" fill={SUN} />
        </svg>
        <div style={{ display: "flex", position: "absolute", left: 96, top: 126 }}>
          <Lockup size={110} color={INK} mark={VIOLET} />
        </div>
        <span style={{ fontFamily: "Outfit", fontSize: 21, letterSpacing: 3, color: "#5d5674", position: "absolute", left: 98, top: 256 }}>
          one search box, one queue
        </span>
      </div>
    ),
    {
      width: W,
      height: H,
      fonts: [
        { name: "Head", data: load("DeliciousHandrawn.woff"), weight: 400, style: "normal" },
        { name: "Gluten", data: load("Gluten.woff"), weight: 400, style: "normal" },
        { name: "Outfit", data: load("Outfit.woff"), weight: 400, style: "normal" },
      ],
    },
  );
}
