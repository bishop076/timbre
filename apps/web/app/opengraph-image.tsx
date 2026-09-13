import { ImageResponse } from "next/og";
import { TimbreMark } from "./shell/brand";

export const alt = "Timbre";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex", width: "100%", height: "100%", position: "relative",
          overflow: "hidden", background: "linear-gradient(120deg, #101017 25%, #292044 100%)",
          color: "#f6f3ff", fontFamily: "sans-serif", alignItems: "center", padding: 96,
        }}
      >
        <div style={{ display: "flex", position: "absolute", right: -150, top: 45,
          width: 540, height: 540, borderRadius: "50%", background: "#121019",
          border: "2px solid #51416e", alignItems: "center", justifyContent: "center" }}>
          {[460, 390, 320, 250].map((diameter) => (
            <div key={diameter} style={{ display: "flex", position: "absolute",
              width: diameter, height: diameter, borderRadius: "50%", border: "2px solid #30283e" }} />
          ))}
          <div style={{ display: "flex", width: 96, height: 96, borderRadius: "50%", background: "#a78bfa" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 32, position: "relative" }}>
          <TimbreMark width={98} height={112} style={{ color: "#a78bfa" }} />
          <span style={{ fontSize: 124, fontWeight: 700, letterSpacing: -6 }}>Timbre</span>
        </div>
      </div>
    ),
    size,
  );
}
