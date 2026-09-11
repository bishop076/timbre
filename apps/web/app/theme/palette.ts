import { isLightTheme, type ThemeState } from "./theme-store.ts";

export interface Swatch {
  hue: number;
  sat: number;
}

export type Palette = Record<string, string>;

const FALLBACK_HUE = { dark: 258, light: 262 };

const CUSTOM_SAT = 0.62;

const NEUTRAL_SAT = 0.04;

const SURFACE_TINT = 0.34;

function hsl(hue: number, sat: number, light: number): string {
  return `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(light * 100)}%)`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function buildPalette(swatch: Swatch | null, theme: ThemeState): Palette {
  const light = isLightTheme(theme);
  const custom = theme.mode === "custom";
  const neutral = custom && theme.customNeutral;

  const hue = custom
    ? theme.customHue
    : (swatch?.hue ?? (light ? FALLBACK_HUE.light : FALLBACK_HUE.dark));

  const sat = neutral
    ? NEUTRAL_SAT
    : custom
      ? CUSTOM_SAT
      : swatch
        ? clamp(swatch.sat, 0.3, 0.7)
        : 0.5;

  const tone = (l: number, s = sat) => hsl(hue, s, l);

  const accentSat = (low: number, high: number) => (neutral ? sat : clamp(sat, low, high));

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
      "--accent-wash": `hsl(${Math.round(hue)} ${Math.round(sat * 70)}% 72% / 0.28)`,
      "--drop": `1px 1px 0 hsl(${Math.round(hue)} ${Math.round(sat * 34)}% 44% / 0.14)`,
      "--drop-sm": `1px 1px 0 hsl(${Math.round(hue)} ${Math.round(sat * 34)}% 44% / 0.14)`,
      "--drop-lg": `2px 2px 0 hsl(${Math.round(hue)} ${Math.round(sat * 34)}% 44% / 0.14)`,
    };
  }

  if (light) {
    const ink = tone(0.44, sat * 0.26);
    const shade = (offset: string) =>
      `${offset} hsl(${Math.round(hue)} ${Math.round(sat * 26)}% 44% / 0.16)`;

    return {
      "--bg": tone(0.9, sat * 0.4),
      "--surface-1": tone(0.96, sat * 0.28),
      "--surface-2": tone(0.88, sat * 0.4),
      "--surface-3": tone(0.8, sat * 0.45),
      "--fg": tone(0.16, sat * 0.4),
      "--fg-dim": tone(0.4, sat * 0.3),
      "--fg-faint": tone(0.56, sat * 0.28),
      "--ink": ink,
      "--line": tone(0.84, sat * 0.3),
      "--accent": tone(neutral ? 0.24 : 0.56, accentSat(0.6, 0.85)),
      "--accent-fg": tone(0.98, sat * 0.2),
      "--accent-wash": `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% 62% / 0.14)`,
      "--drop": shade("1px 1px 0"),
      "--drop-sm": shade("1px 1px 0"),
      "--drop-lg": shade("2px 2px 0"),
    };
  }

  const surfaceSat = sat * SURFACE_TINT;
  const shadow = "hsl(0 0% 0% / 0.85)";
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
    "--accent-wash": `hsl(${Math.round(hue)} ${Math.round(sat * 100)}% 55% / 0.1)`,
    "--drop": `3px 3px 0 ${shadow}`,
    "--drop-sm": `2px 2px 0 ${shadow}`,
    "--drop-lg": `5px 5px 0 ${shadow}`,
  };
}

export function lightnessOf(color: string): number | null {
  const match = /hsl\(\s*[\d.]+\s+[\d.]+%\s+([\d.]+)%/.exec(color);
  return match ? Number(match[1]) : null;
}
