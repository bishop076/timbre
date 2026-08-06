"use client";

import { CheckIcon } from "../icons";
import {
  setCustomHue,
  setCustomLight,
  setNeutral,
  setThemeMode,
  useTheme,
  type ThemeMode,
} from "./theme-store";

/**
 * Choosing how the app looks.
 *
 * Each option is previewed in **its own colours** rather than described in
 * words. "Album" and "Pastel" are ideas about how colour behaves over time, not
 * fixed palettes, so a swatch is worth more than a name — and the custom row is
 * the only one where a name would be meaningless anyway.
 *
 * Lives on the profile page because that is where the other per-browser
 * preferences already are, and this is one more thing stored on this device
 * only.
 */

const MODES: { id: ThemeMode; label: string; blurb: string }[] = [
  {
    id: "album",
    label: "Album",
    blurb: "Dark, and coloured by whatever is playing.",
  },
  {
    id: "pastel",
    label: "Pastel",
    blurb: "Light and soft, still tinted by the cover.",
  },
  {
    id: "custom",
    label: "One colour",
    blurb: "Pick a colour and it never changes.",
  },
];

/**
 * Twelve hues, evenly spaced.
 *
 * A ring rather than a native colour input: `<input type="color">` opens the
 * operating system's picker, which is a modal dialogue in a font and language
 * Timbre does not control, for a decision that is one of twelve. Saturation and
 * lightness are the palette's job in any case — only the hue is the reader's.
 */
const HUES = Array.from({ length: 12 }, (_, index) => index * 30);

export function ThemePicker() {
  const theme = useTheme();

  return (
    <section>
      <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--fg-dim)] sm:text-sm">Theme</h2>
      <p className="mt-1.5 text-xs leading-relaxed text-[var(--fg-faint)]">
        Saved in this browser, like everything else here.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:mt-4 sm:gap-2.5 @md:grid-cols-3">
        {MODES.map((mode) => {
          const active = theme.mode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              onClick={() => setThemeMode(mode.id)}
              aria-pressed={active}
              className={`slab press relative rounded-[var(--r-lg)] p-2 text-left transition sm:p-3.5 ${
                active ? "bg-[var(--surface-2)]" : "bg-[var(--surface-1)]"
              }`}
            >
              {active && (
                <span
                  className="slab-sm absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-[var(--r-full)] text-[var(--accent-fg)] sm:right-2.5 sm:top-2.5 sm:size-5"
                  style={{ background: "var(--accent)" }}
                >
                  <CheckIcon className="size-3" />
                </span>
              )}

              {/* The preview is the argument. Each strip is the mode's own
                  ground and accent, so the choice is visible before it is made. */}
              <span
                aria-hidden
                className="slab-sm flex h-8 w-full items-end gap-1 overflow-hidden rounded-[var(--r-md)] p-1 sm:h-11 sm:p-1.5"
                style={{ background: previewGround({ ...theme, mode: mode.id }) }}
              >
                {[0.55, 0.8, 1].map((scale) => (
                  <span
                    key={scale}
                    className="flex-1 rounded-[3px]"
                    style={{
                      height: `${scale * 100}%`,
                      background: previewAccent({ ...theme, mode: mode.id }),
                      opacity: scale,
                    }}
                  />
                ))}
              </span>

              <span className="mt-1.5 block truncate text-xs font-bold sm:mt-2.5 sm:text-sm">{mode.label}</span>
              <span className="mt-0.5 hidden text-xs leading-relaxed text-[var(--fg-dim)] sm:block">
                {mode.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {/* Only shown for the mode it belongs to. Controls for an inactive mode
          would change something invisible, which reads as a broken button. */}
      {theme.mode === "custom" && (
        <div className="slab mt-3 rounded-[var(--r-lg)] bg-[var(--surface-1)] p-2.5 sm:p-3.5">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--fg-dim)]">
            Your colour
          </p>

          <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-2.5 sm:gap-2">
            {/*
              White and dark first, because "no colour" is a choice about the
              whole app rather than one more hue — and putting them at the end
              of a colour ring would read as two more colours.
            */}
            {[
              { light: true, label: "White", swatch: "#ffffff" },
              { light: false, label: "Dark", swatch: "#131318" },
            ].map((option) => {
              const active = theme.customNeutral && theme.customLight === option.light;
              return (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => setNeutral(option.light)}
                  aria-label={option.label}
                  aria-pressed={active}
                  title={option.label}
                  className={`press size-7 rounded-[var(--r-full)] border-[length:var(--edge)] transition sm:size-8 ${
                    active ? "scale-110 border-[var(--fg)]" : "border-[var(--ink)]"
                  }`}
                  style={{ background: option.swatch }}
                />
              );
            })}

            {/* A gap, so the neutrals read as their own pair. */}
            <span aria-hidden className="w-1.5" />

            {HUES.map((hue) => {
              const active = !theme.customNeutral && theme.customHue === hue;
              return (
                <button
                  key={hue}
                  type="button"
                  onClick={() => setCustomHue(hue)}
                  aria-label={`Hue ${hue} degrees`}
                  aria-pressed={active}
                  className={`press size-7 rounded-[var(--r-full)] border-[length:var(--edge)] transition sm:size-8 ${
                    active ? "scale-110 border-[var(--fg)]" : "border-[var(--ink)]"
                  }`}
                  style={{ background: `hsl(${hue} 62% ${theme.customLight ? 62 : 70}%)` }}
                />
              );
            })}
          </div>

          {/* Hidden for the neutrals: "White" already names its ground, and a
              white theme on a dark ground is not a thing anyone can want. */}
          <div className={`mt-4 items-center gap-2 ${theme.customNeutral ? "hidden" : "flex"}`}>
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--fg-dim)]">
              Ground
            </span>
            {[
              { light: false, label: "Dark" },
              { light: true, label: "Light" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => setCustomLight(option.light)}
                aria-pressed={theme.customLight === option.light}
                className={`press rounded-[var(--r-full)] px-3 py-1 text-[11px] font-bold ${
                  theme.customLight === option.light
                    ? "slab-sm text-[var(--accent-fg)]"
                    : "bg-[var(--surface-2)] text-[var(--fg-dim)]"
                }`}
                style={
                  theme.customLight === option.light ? { background: "var(--accent)" } : undefined
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The ground a mode paints on, for its preview strip.
 *
 * Album's swatch is deliberately close to neutral — the ramp only carries about
 * a third of the hue on its surfaces, and a vivid preview would promise a more
 * colourful app than the one it selects.
 */
function previewGround(theme: {
  mode: ThemeMode;
  customHue: number;
  customLight: boolean;
  customNeutral: boolean;
}): string {
  if (theme.mode === "album") return "hsl(258 12% 7%)";
  if (theme.mode === "pastel") return "hsl(280 30% 96%)";
  if (theme.customNeutral) return theme.customLight ? "hsl(0 0% 100%)" : "hsl(240 6% 8%)";
  return theme.customLight ? `hsl(${theme.customHue} 40% 90%)` : `hsl(${theme.customHue} 14% 8%)`;
}

/** The accent a mode shows, for its preview strip. */
function previewAccent(theme: {
  mode: ThemeMode;
  customHue: number;
  customLight: boolean;
  customNeutral: boolean;
}): string {
  if (theme.mode === "album") return "hsl(258 75% 70%)";
  if (theme.mode === "pastel") return "hsl(300 52% 72%)";
  if (theme.customNeutral) return theme.customLight ? "hsl(0 0% 22%)" : "hsl(0 0% 88%)";
  return `hsl(${theme.customHue} 62% 62%)`;
}
