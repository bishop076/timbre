import { ImageResponse } from "next/og";
import { TimbreMark } from "./shell/brand";

export const alt = "Timbre — all your music, one search. YouTube Music, SoundCloud and more.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex", width: "100%", height: "100%", position: "relative",
          overflow: "hidden", background: "linear-gradient(120deg, #101017 25%, #292044 100%)",
          color: "#f6f3ff", fontFamily: "sans-serif", padding: 64,
        }}
      >
        <div style={{ display: "flex", position: "absolute", right: -125, top: 50,
          width: 540, height: 540, borderRadius: "50%", background: "#121019",
          border: "2px solid #51416e", alignItems: "center", justifyContent: "center" }}>
          {[460, 390, 320, 250].map((diameter) => (
            <div key={diameter} style={{ display: "flex", position: "absolute",
              width: diameter, height: diameter, borderRadius: "50%", border: "2px solid #30283e" }} />
          ))}
          <div style={{ display: "flex", width: 176, height: 176, borderRadius: "50%",
            background: "#a78bfa", color: "#171020", alignItems: "center", justifyContent: "center" }}>
            <TimbreMark width={66} height={76} />
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", position: "relative", width: 770 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18, color: "#c4afff" }}>
            <TimbreMark width={39} height={45} />
            <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>Timbre</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 65,
            fontSize: 80, fontWeight: 700, lineHeight: 1.06, letterSpacing: -4 }}>
            <span>All your music.</span>
            <span style={{ color: "#bda4ff" }}>One search.</span>
          </div>
          <div style={{ display: "flex", marginTop: 30, fontSize: 24, color: "#bbb4ce" }}>
            Find your next favorite. Press play.
          </div>
          <div style={{ display: "flex", marginTop: "auto", alignItems: "center", gap: 14,
            fontSize: 19, color: "#dad2ea" }}>
            <span>YouTube Music</span>
            <span style={{ color: "#8973aa" }}>·</span>
            <span>SoundCloud</span>
            <span style={{ color: "#8973aa" }}>·</span>
            <span>And more</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
