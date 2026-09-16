"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { CheckIcon, SpinnerIcon, TrashIcon } from "../icons";
import { Caption } from "../page-chrome";
import { useFilePicker } from "../profile/image-picker";
import { rememberAccent, useAccentHistory } from "./accent-history";
import {
  ACCEPT as ACCEPT_IMAGE,
  clearBackgroundImage,
  getBackground,
  serverBackground,
  setBackgroundImage,
  subscribeBackground,
} from "./background";
import { contrastRatio, normaliseHex, readableOn } from "./color";
import {
  CYCLE_STEP_MS,
  MAX_DIM,
  MIN_DIM,
  PRESETS,
  resolveGround,
  scrimIsReadable,
  type AccentSource,
  type BackgroundFit,
  type Contrast,
  type Ground,
  type Theme,
} from "./custom-theme";
import { buildPalette } from "./palette";
import { ACCEPT as ACCEPT_FONT, clearCustomFont, FONTS, setCustomFont, type FontId } from "./fonts";
import { prefersDark } from "./theme-css";
import {
  chooseAccent,
  resetTheme,
  setAccentSource,
  setBackgroundPrefs,
  setContrast,
  setFont,
  setGround,
  setTextSize,
  setTintSurfaces,
  useAccentSeed,
  useTheme,
} from "./theme-store";

const GROUNDS: { id: Ground; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Follow system" },
];

/**
 * A note only where the label cannot carry it. "Album art" and "One colour" say what they do;
 * "Cycling" does not say how fast, and a reader watching a still screen deserves the number
 * rather than a sentence about drifting.
 */
const SOURCES: { id: AccentSource; label: string; note?: string }[] = [
  { id: "fixed", label: "One colour" },
  { id: "artwork", label: "Album art" },
  { id: "cycle", label: "Cycling", note: `New hue every ${CYCLE_STEP_MS / 1000} seconds.` },
];

const FITS: { id: BackgroundFit; label: string }[] = [
  { id: "cover", label: "Fill" },
  { id: "contain", label: "Fit" },
  { id: "tile", label: "Tile" },
];

/* ------------------------------------------------------------------ small pieces */

function Group({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="slab mt-3 rounded-[var(--r-lg)] bg-[var(--surface-1)] p-3 sm:p-3.5">
      <h3 className="text-[13px] font-bold">{title}</h3>
      {detail && <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-dim)]">{detail}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-pressed={selected}
            className={`press rounded-[var(--r-full)] px-3 py-1.5 text-[12px] font-bold ${
              selected
                ? "slab-sm text-[var(--accent-fg)]"
                : "slab-ghost bg-[var(--surface-2)] text-[var(--fg-dim)]"
            }`}
            style={selected ? { background: "var(--accent)" } : undefined}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 py-1.5">
      <span className="w-24 shrink-0 text-xs font-semibold text-[var(--fg-dim)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-[var(--r-full)] bg-[var(--surface-3)] accent-[var(--accent)]"
      />
      <output className="w-12 shrink-0 text-right font-mono text-[11px] text-[var(--fg-faint)]">
        {format(value)}
      </output>
    </label>
  );
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-2 text-[11px] leading-relaxed text-[var(--warn)]">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ colour */

/**
 * How long after the last change a colour counts as chosen rather than passed through.
 *
 * The wheel fires on every step of a drag, and the theme follows within 120ms so the app moves
 * under the reader's hand — but three history slots filled with the colours a drag happened to
 * cross would be worse than no history at all. A pause this long, or leaving the control, is
 * the difference between the two.
 */
const SETTLED_MS = 900;

function ColourField({ accent }: { accent: string }) {
  const [draft, setDraft] = useState(accent);
  const [bad, setBad] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chosen = useRef<string | null>(null);
  const typing = useRef(false);

  // The field follows the theme while the reader is not in it — cycling, or a cover, moves the
  // colour under them — and stops fighting them the moment they start typing.
  useEffect(() => {
    if (!typing.current) setDraft(accent);
  }, [accent]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  /** Records what was last landed on, whether by pausing on it or by leaving the control. */
  function remember(): void {
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
    if (chosen.current) rememberAccent(chosen.current);
    chosen.current = null;
  }

  function commit(next: string, delay: number): void {
    setDraft(next);
    const hex = normaliseHex(next);
    setBad(next.trim() !== "" && hex === null);
    if (!hex) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => chooseAccent(hex), delay);
    chosen.current = hex;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(remember, SETTLED_MS);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="slab-sm press relative size-9 shrink-0 overflow-hidden rounded-[var(--r-md)]">
        <span className="sr-only">Pick a colour</span>
        <input
          type="color"
          value={normaliseHex(draft) ?? accent}
          onChange={(event) => commit(event.target.value, 120)}
          onBlur={remember}
          className="absolute -inset-2 size-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
        />
      </label>

      <div className="min-w-0 flex-1 basis-40">
        <input
          type="text"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-label="Colour, as hex, rgb() or a name"
          aria-invalid={bad}
          placeholder="#5b3fd6"
          onFocus={() => (typing.current = true)}
          onBlur={() => {
            typing.current = false;
            setBad(false);
            setDraft(accent);
            remember();
          }}
          onChange={(event) => commit(event.target.value, 350)}
          className="slab-sm w-full rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-2 font-mono text-[12px] outline-none focus-visible:bg-[var(--surface-3)]"
        />
      </div>

      {bad && (
        <p role="alert" className="basis-full text-[11px] text-[var(--warn)]">
          Not a colour. Try #5b3fd6, rgb(91 63 214) or violet.
        </p>
      )}
    </div>
  );
}

function Dot({
  hex,
  label,
  active,
  onPick,
}: {
  hex: string;
  label: string;
  active: boolean;
  onPick: (hex: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(hex)}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`press flex size-7 items-center justify-center rounded-[var(--r-full)] border-[length:var(--edge)] transition sm:size-8 ${
        active ? "scale-110 border-[var(--fg)]" : "border-[var(--ink)]"
      }`}
      style={{ background: hex, color: readableOn(hex) }}
    >
      {active && <CheckIcon className="size-3.5" />}
    </button>
  );
}

/**
 * The eight templates, then — behind a rule — the last three colours the reader mixed for
 * themselves. Presets are left out of that list on purpose: one is never more than a tap away
 * on the row above, and repeating it here would spend a slot saying so twice.
 */
function Swatches({ accent, onPick }: { accent: string; onPick: (hex: string) => void }) {
  const history = useAccentHistory();

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((preset) => (
        <Dot
          key={preset.hex}
          hex={preset.hex}
          label={preset.name}
          active={preset.hex === accent}
          onPick={onPick}
        />
      ))}

      {history.length > 0 && (
        <>
          <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-[var(--line)]" />
          {history.map((hex) => (
            <Dot
              key={hex}
              hex={hex}
              label={`Yours, ${hex}`}
              active={hex === accent}
              onPick={onPick}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Readout({ theme }: { theme: Theme }) {
  // The live seed, not the stored one: in "from the cover" and "slowly changing" they are two
  // different colours, and the reader is owed the one they are actually looking at. The store
  // keeps it, so nothing here has to read a clock during a render.
  const seed = useAccentSeed();

  // Built by the same function that paints the page, from the same input, rather than by a
  // second formula that agrees with it until one of them is edited. What this row reports is
  // by construction what is on screen.
  const palette = buildPalette(null, { ...theme, customSeed: seed });
  const accent = palette["--accent"];
  const ratio = contrastRatio(accent, palette["--accent-fg"]);

  // The swatch and the hex are the *used* colour, not the chosen one, because that is what the
  // reader is looking at everywhere else in the app. Where the two differ, the chosen one is
  // named rather than quietly dropped.
  const moved = seed.toLowerCase() !== accent.toLowerCase();

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <span
        className="slab-sm rounded-[var(--r-full)] px-3 py-1 text-[12px] font-bold"
        style={{ background: accent, color: palette["--accent-fg"] }}
      >
        Aa
      </span>
      <span className="font-mono text-[11px] text-[var(--fg-faint)]">{accent}</span>
      <span className="text-[11px] text-[var(--fg-dim)]">
        {ratio.toFixed(1)}:1 for text on it
        {moved && ` · adjusted from ${seed}`}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ background */

function BackgroundGroup({ theme, light }: { theme: Theme; light: boolean }) {
  const image = useSyncExternalStore(subscribeBackground, getBackground, serverBackground);
  const picker = useFilePicker(ACCEPT_IMAGE, "Couldn't use that picture.", (file) =>
    setBackgroundImage(file),
  );
  const readable = scrimIsReadable(theme.background.dim, light, light ? "#232733" : "#f4f4f7");

  return (
    <Group title="Background picture">
      {picker.input}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={picker.open}
          disabled={picker.busy}
          className="slab-sm press flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-bold disabled:opacity-50"
        >
          {picker.busy && <SpinnerIcon className="size-4 animate-spin" />}
          {image ? "Change picture" : "Choose a picture"}
        </button>

        {image && (
          <>
            <button
              type="button"
              onClick={() => {
                clearBackgroundImage();
                picker.setError(null);
              }}
              className="slab-sm press flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-bold hover:text-[var(--danger)]"
            >
              <TrashIcon className="size-4" />
              Remove
            </button>
            <span
              aria-hidden
              className="slab-sm size-9 shrink-0 rounded-[var(--r-md)] bg-cover bg-center"
              style={{ backgroundImage: `url(${JSON.stringify(image)})` }}
            />
          </>
        )}
      </div>

      {picker.error && (
        <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">
          {picker.error}
        </p>
      )}

      {image && (
        <div className="mt-3">
          <Segmented
            label="Picture fit"
            value={theme.background.fit}
            options={FITS}
            onChange={(fit) => setBackgroundPrefs({ fit })}
          />
          <div className="mt-2">
            <Slider
              label="Dimming"
              min={MIN_DIM}
              max={MAX_DIM}
              step={0.01}
              value={theme.background.dim}
              format={(value) => `${Math.round(value * 100)}%`}
              onChange={(dim) => setBackgroundPrefs({ dim })}
            />
            <Slider
              label="Blur"
              min={0}
              max={40}
              step={1}
              value={theme.background.blur}
              format={(value) => `${value}px`}
              onChange={(blur) => setBackgroundPrefs({ blur })}
            />
          </div>
          {!readable && (
            <Problem>Text will be hard to read over the brightest parts. Dim it, or add blur.</Problem>
          )}
        </div>
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------ fonts */

function FontGroup({ theme }: { theme: Theme }) {
  const picker = useFilePicker(ACCEPT_FONT, "Couldn't use that font.", async (file) => {
    const family = await setCustomFont(file);
    setFont("custom", family);
  });

  return (
    <Group title="Typeface">
      {picker.input}

      <div className="grid gap-1.5 sm:grid-cols-2">
        {FONTS.map((font) => {
          const selected = theme.font.id === font.id;
          const custom = font.id === "custom";
          return (
            <button
              key={font.id}
              type="button"
              onClick={() => (custom ? picker.open() : setFont(font.id as FontId))}
              aria-pressed={selected}
              className={`slab-sm press rounded-[var(--r-md)] px-3 py-2 text-left transition ${
                selected ? "bg-[var(--surface-3)]" : "bg-[var(--surface-2)]"
              }`}
              style={font.stack ? { fontFamily: font.stack } : undefined}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-bold">
                {custom && theme.font.family ? theme.font.family : font.label}
                {selected && <CheckIcon className="size-3.5 shrink-0 text-[var(--accent-text)]" />}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-[var(--fg-dim)]">
                {font.note}
              </span>
            </button>
          );
        })}
      </div>

      {picker.busy && (
        <p className="mt-2 flex items-center gap-2 text-[11px] text-[var(--fg-dim)]">
          <SpinnerIcon className="size-3.5 animate-spin" />
          Reading the font…
        </p>
      )}

      {picker.error && (
        <p role="alert" className="mt-2 text-[11px] text-[var(--danger)]">
          {picker.error}
        </p>
      )}

      {theme.font.id === "custom" && theme.font.family && (
        <button
          type="button"
          onClick={() => {
            clearCustomFont();
            setFont("default");
          }}
          className="press mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-[var(--fg-dim)] hover:text-[var(--danger)]"
        >
          <TrashIcon className="size-3.5" />
          Forget {theme.font.family}
        </button>
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------ the panel */

export function ThemePicker() {
  const theme = useTheme();
  const light = resolveGround(theme, prefersDark()) === "light";
  const note = SOURCES.find((source) => source.id === theme.accentSource)?.note;

  return (
    <section>
      <Caption>Saved in this browser. Pictures and fonts you add stay on this device.</Caption>

      <Group title="Ground">
        <Segmented label="Ground" value={theme.ground} options={GROUNDS} onChange={setGround} />
      </Group>

      <Group title="Colour">
        <Segmented
          label="Colour source"
          value={theme.accentSource}
          options={SOURCES}
          onChange={setAccentSource}
        />
        {note && <p className="mt-1.5 text-[11px] text-[var(--fg-dim)]">{note}</p>}

        <div className="mt-3 space-y-2.5">
          <Swatches accent={theme.accent} onPick={chooseAccent} />
          <ColourField accent={theme.accent} />
        </div>

        <Readout theme={theme} />

        <label className="mt-3 flex items-center gap-2.5 text-[12px] font-semibold">
          <input
            type="checkbox"
            checked={theme.tintSurfaces}
            onChange={(event) => setTintSurfaces(event.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Tint the greys
        </label>
      </Group>

      <Group title="Readability" detail="Your colour is adjusted until it clears this.">
        <Segmented
          label="Contrast"
          value={theme.contrast}
          options={[
            { id: "normal" as Contrast, label: "Normal" },
            { id: "high" as Contrast, label: "High" },
          ]}
          onChange={setContrast}
        />
        <div className="mt-2">
          <Slider
            label="Text size"
            min={0.85}
            max={1.5}
            step={0.05}
            value={theme.textScale}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={setTextSize}
          />
        </div>
      </Group>

      <FontGroup theme={theme} />
      <BackgroundGroup theme={theme} light={light} />

      <button
        type="button"
        onClick={resetTheme}
        className="press mt-3 text-[11px] font-semibold text-[var(--fg-dim)] underline decoration-dotted hover:text-[var(--fg)]"
      >
        Reset appearance
      </button>
    </section>
  );
}
