import { isLightTheme, type ThemeState } from "./theme-store.ts";

export interface Swatch {
  hue: number;
  sat: number;
}

export type Palette = Record<string, string>;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function buildPalette(swatch: Swatch | null, theme: ThemeState): Palette {
  const light = isLightTheme(theme);
  const custom = theme.mode === "custom";
  const neutral = custom && theme.customNeutral;

  const hue = Math.round(custom ? theme.customHue : (swatch?.hue ?? (light ? 262 : 258)));
  const sat = neutral ? 0.04 : custom ? 0.62 : swatch ? clamp(swatch.sat, 0.3, 0.7) : 0.5;

  const tone = (l: number, s = sat) => `hsl(${hue} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const glow = (satPercent: number, lightPercent: number, alpha: number) =>
    `hsl(${hue} ${Math.round(sat * satPercent)}% ${lightPercent}% / ${alpha})`;
  const accentSat = (low: number, high: number) => (neutral ? sat : clamp(sat, low, high));
  const drops = (color: string, md = 1, sm = 1, lg = 2) => ({
    "--drop": `${md}px ${md}px 0 ${color}`,
    "--drop-sm": `${sm}px ${sm}px 0 ${color}`,
    "--drop-lg": `${lg}px ${lg}px 0 ${color}`,
  });

  if (theme.mode === "pastel") {
    return {
      "--bg": tone(0.96, sat * 0.3),
      "--surface-1": tone(0.99, sat * 0.18),
      "--surface-2": tone(0.93, sat * 0.34),
      "--surface-3": tone(0.87, sat * 0.4),
      "--fg": tone(0.22, sat * 0.5),
      "--fg-dim": tone(0.45, sat * 0.32),
      "--fg-faint": tone(0.62, sat * 0.28),
      "--ink": tone(0.44, sat * 0.34),
      "--line": tone(0.85, sat * 0.3),
      "--accent": tone(0.7, accentSat(0.45, 0.62)),
      "--accent-fg": tone(0.18, sat * 0.5),
      "--accent-wash": glow(70, 72, 0.28),
      ...drops(glow(34, 44, 0.14)),
    };
  }

  if (light) {
    return {
      "--bg": tone(0.9, sat * 0.4),
      "--surface-1": tone(0.96, sat * 0.28),
      "--surface-2": tone(0.88, sat * 0.4),
      "--surface-3": tone(0.8, sat * 0.45),
      "--fg": tone(0.16, sat * 0.4),
      "--fg-dim": tone(0.4, sat * 0.3),
      "--fg-faint": tone(0.56, sat * 0.28),
      "--ink": tone(0.44, sat * 0.26),
      "--line": tone(0.84, sat * 0.3),
      "--accent": tone(neutral ? 0.24 : 0.56, accentSat(0.6, 0.85)),
      "--accent-fg": tone(0.98, sat * 0.2),
      "--accent-wash": glow(100, 62, 0.14),
      ...drops(glow(26, 44, 0.16)),
    };
  }

  const surfaceSat = sat * 0.34;
  return {
    "--bg": tone(0.07, surfaceSat),
    "--surface-1": tone(0.11, surfaceSat),
    "--surface-2": tone(0.16, surfaceSat * 0.95),
    "--surface-3": tone(0.22, surfaceSat * 0.9),
    "--fg": tone(0.95, sat * 0.14),
    "--fg-dim": tone(0.73, sat * 0.12),
    "--fg-faint": tone(0.55, sat * 0.12),
    "--ink": tone(0.03, surfaceSat),
    "--line": tone(0.26, surfaceSat),
    "--accent": tone(0.7, accentSat(0.6, 0.9)),
    "--accent-fg": tone(0.08, sat * 0.5),
    "--accent-wash": glow(100, 55, 0.1),
    ...drops("hsl(0 0% 0% / 0.85)", 3, 2, 5),
  };
}
