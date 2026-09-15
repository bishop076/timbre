"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  GithubIcon,
  InfoIcon,
  KeyboardIcon,
  LogsIcon,
  NoteIcon,
  PaletteIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  TrashIcon,
} from "../icons";
import { clearLogs, log, useLogs, type LogLevel } from "../logs.ts";
import { Caption } from "../page-chrome";
import { setPlaybackPref, usePlaybackPrefs } from "../player/playback-prefs";
import { SpotifyConnect } from "../spotify/connect-panel";

const ThemePicker = dynamic(() => import("../theme/theme-picker").then((m) => m.ThemePicker));

const REPO = "https://github.com/bishop076/timbre";

const COMMIT = process.env.NEXT_PUBLIC_TIMBRE_COMMIT;
const VERSION =
  `v${process.env.NEXT_PUBLIC_TIMBRE_VERSION ?? "0.0.0"}` + (COMMIT ? ` (${COMMIT})` : "");

const SECTIONS = [
  {
    id: "general",
    label: "General",
    Icon: SettingsIcon,
    render: () => <General />,
  },
  { id: "sources", label: "Sources", Icon: NoteIcon, render: () => <SpotifyConnect /> },
  { id: "shortcuts", label: "Shortcuts", Icon: KeyboardIcon, render: () => <Shortcuts /> },
  { id: "appearance", label: "Appearance", Icon: PaletteIcon, render: () => <ThemePicker /> },
  { id: "logs", label: "Logs", Icon: LogsIcon, render: () => <Logs /> },
  { id: "whats-new", label: "What’s New", Icon: SparkleIcon, render: () => <WhatsNew /> },
  { id: "about", label: "About", Icon: InfoIcon, render: () => <About /> },
];

const PAGES = [
  {
    href: "/about",
    label: "About Timbre",
    detail: "What it does, who actually serves the music, and what to do when something won't play.",
  },
  {
    href: "/privacy",
    label: "Privacy",
    detail: "What Timbre stores about you, which is nothing, and what the services it embeds can see.",
  },
];

/**
 * The white card every group in this modal sits in.
 *
 * Deliberately the same shape theme-picker.tsx already draws for its own groups — the
 * Appearance tab is rendered by a file this one does not own, so the only way the modal reads
 * as one screen rather than two is for both halves to use the same card. The content column
 * behind them is --bg, the blush, which is what makes a white card a card at all.
 */
function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <section
      className={`slab rounded-[var(--r-lg)] bg-[var(--surface-1)] p-3 sm:p-3.5 ${className}`.trim()}
    >
      {children}
    </section>
  );
}

function About() {
  return (
    <Card className="divide-y divide-[var(--line)]">
      {PAGES.map((page) => (
        <Link
          key={page.href}
          href={page.href}
          className="group flex items-center gap-4 py-3.5 first:pt-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[var(--text-meta)] font-bold transition group-hover:text-[var(--accent)]">
              {page.label}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-dim)]">{page.detail}</p>
          </div>
          <ChevronIcon className="size-4 shrink-0 -rotate-90 text-[var(--fg-faint)] transition group-hover:text-[var(--fg)]" />
        </Link>
      ))}
    </Card>
  );
}

const SHORTCUTS: { keys: string[]; action: string; note?: string }[] = [
  { keys: ["Space"], action: "Play or pause", note: "Once something is loaded" },
  { keys: ["→"], action: "Next track" },
  { keys: ["←"], action: "Previous track" },
  { keys: ["↑"], action: "Volume up" },
  { keys: ["↓"], action: "Volume down" },
  { keys: ["/"], action: "Search", note: "Home, Explore and Search" },
  { keys: ["Esc"], action: "Leave the search field" },
];

function Shortcuts() {
  return (
    <>
      <Caption>
        Ignored while you are typing, and whenever a modifier is held — so these
        never take a key another application wanted.
      </Caption>

      <Card className="mt-3 divide-y divide-[var(--line)]">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.action} className="flex items-center gap-4 py-2.5 first:pt-0">
            <span className="flex shrink-0 gap-1">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="slab-sm min-w-7 rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2 py-1 text-center font-mono text-[11px] text-[var(--fg)]"
                >
                  {key}
                </kbd>
              ))}
            </span>
            <span className="min-w-0 flex-1 text-[var(--text-meta)] font-medium">{shortcut.action}</span>
            {shortcut.note && (
              <span className="shrink-0 text-[11px] text-[var(--fg-faint)]">{shortcut.note}</span>
            )}
          </li>
        ))}
      </Card>
    </>
  );
}

/**
 * The level tones are the two new tokens, not Tailwind’s palette.
 *
 * `warn` was `text-[var(--warn)]` and `error` was `text-[var(--danger)]`, both measured against the
 * white the list sits on in the blush theme: 1.82:1 and 2.46:1. A warning nobody can read is
 * worse than no warning, because the panel still looks like it is doing its job. --warn and
 * --danger are defined per theme and come out at 6.06:1 and 5.56:1 light, 12.17:1 and 8.83:1
 * dark. The accent is not an option for either: the pink is a fill, and as text it is 2.60:1.
 */
const LEVEL_TONE: Record<LogLevel, string> = {
  info: "text-[var(--fg-faint)]",
  warn: "text-[var(--warn)]",
  error: "text-[var(--danger)]",
};

/** A rail down the left of the row, so warnings and errors are findable without reading. */
const LEVEL_RAIL: Record<LogLevel, string> = {
  info: "border-transparent",
  warn: "border-[var(--warn)]",
  error: "border-[var(--danger)]",
};

const LEVELS = ["info", "warn", "error"] as const;

/** Local to this file on purpose: icons.tsx is shared, and this is the only caller. */
function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2" strokeLinejoin="round" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Seconds are not enough. The question this panel exists to answer is usually “what happened
 * between those two”, and two sources answering 40ms apart look simultaneous without the
 * milliseconds. The machine-readable full timestamp stays in `dateTime`.
 */
function stamp(at: number): string {
  const when = new Date(at);
  const ms = String(when.getMilliseconds()).padStart(3, "0");
  return `${when.toLocaleTimeString(undefined, { hour12: false })}.${ms}`;
}

function Chip({
  tone,
  active,
  disabled,
  onClick,
  children,
}: {
  tone: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`press rounded-[var(--r-full)] px-2.5 py-1 text-[11px] font-bold tabular-nums transition disabled:opacity-35 ${tone} ${
        active ? "slab-sm" : "slab-ghost hover:bg-[var(--surface-2)]"
      }`}
      // The selected wash is mixed from the chip’s own colour, so each level highlights in its
      // own tone without needing a second token per level, and it follows a custom theme free.
      // The ink edge does the work of saying "pressed"; the wash only says which one.
      style={{
        background: active
          ? "color-mix(in oklab, currentColor 22%, var(--surface-1))"
          : "var(--surface-1)",
      }}
    >
      {children}
    </button>
  );
}

function Logs() {
  const entries = useLogs();
  const [level, setLevel] = useState<LogLevel | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const needle = query.trim().toLowerCase();
  // `text`, not `message`: `message` carries the “×12” repeat marker logs.ts appends, and
  // filtering on that would make a line stop matching its own words once it started repeating.
  const shown = entries.filter(
    (entry) =>
      (level === null || entry.level === level) &&
      (needle === "" || entry.text.toLowerCase().includes(needle)),
  );

  const filtered = level !== null || needle !== "";

  async function copy() {
    const text = shown
      .map(
        (entry) =>
          `${new Date(entry.at).toISOString()}  ${entry.level.toUpperCase().padEnd(5)}  ${entry.message}`,
      )
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Into the very panel being copied, which is the right place for it: the reader is
      // already looking here, and a Copy button that silently does nothing is the worst kind.
      log("warn", "Logs: this browser refused clipboard access, so nothing was copied.");
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Caption className="max-w-prose">
        Which sources answered, which refused, and why a track fell back to another copy of
        itself. This tab only — none of it is written anywhere, and closing the tab loses it.
        Only the newest entries are kept; older ones drop off the end.
      </Caption>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-44">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--fg-faint)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            disabled={entries.length === 0}
            placeholder="Filter messages"
            aria-label="Filter log messages"
            className="slab-sm w-full rounded-[var(--r-full)] bg-[var(--surface-1)] py-1.5 pl-8 pr-3 text-[var(--text-meta)] outline-none transition placeholder:text-[var(--fg-faint)] focus:bg-[var(--surface-2)] disabled:opacity-40"
          />
        </div>

        <button
          type="button"
          onClick={() => void copy()}
          disabled={shown.length === 0}
          aria-label={filtered ? "Copy the filtered entries" : "Copy every entry"}
          className="slab-sm press flex shrink-0 items-center gap-1.5 rounded-[var(--r-full)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-meta)] font-semibold transition hover:bg-[var(--surface-2)] disabled:opacity-35"
        >
          {copied ? (
            // Not --accent: the pink is a fill colour, and as a 14px glyph on white it is
            // 2.60:1. The tick reads as confirmation from its shape and its timing.
            <CheckIcon className="size-3.5 shrink-0 text-[var(--fg)]" />
          ) : (
            <CopyIcon className="size-3.5 shrink-0" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>

        <button
          type="button"
          onClick={clearLogs}
          disabled={entries.length === 0}
          className="slab-sm press flex shrink-0 items-center gap-1.5 rounded-[var(--r-full)] bg-[var(--surface-1)] px-3 py-1.5 text-[var(--text-meta)] font-semibold transition hover:bg-[var(--surface-2)] disabled:opacity-35"
        >
          <TrashIcon className="size-3.5 shrink-0" />
          Clear
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Chip
          tone="text-[var(--fg-dim)]"
          active={level === null}
          disabled={entries.length === 0}
          onClick={() => setLevel(null)}
        >
          All {entries.length}
        </Chip>
        {LEVELS.map((name) => {
          const count = entries.filter((entry) => entry.level === name).length;
          return (
            <Chip
              key={name}
              tone={LEVEL_TONE[name]}
              active={level === name}
              disabled={count === 0}
              onClick={() => setLevel(level === name ? null : name)}
            >
              {name} {count}
            </Chip>
          );
        })}

        <p
          aria-live="polite"
          className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--fg-faint)]"
        >
          {filtered ? `${shown.length} of ${entries.length}` : `${entries.length} kept`}
        </p>
      </div>

      {entries.length === 0 ? (
        <Notice title="Nothing has happened yet">
          Search for something, or play a track, and what each source said turns up here.
        </Notice>
      ) : shown.length === 0 ? (
        <Notice title="Nothing matches that">
          {entries.length} {entries.length === 1 ? "entry is" : "entries are"} hidden by the
          filter.{" "}
          <button
            type="button"
            onClick={() => {
              setLevel(null);
              setQuery("");
            }}
            className="slab-sm press mt-2 inline-flex rounded-[var(--r-full)] px-3 py-1 text-[11px] font-bold text-[var(--accent-fg)]"
            style={{ background: "var(--accent)" }}
          >
            Show everything
          </button>
        </Notice>
      ) : (
        <ul
          aria-label="Log entries, newest first"
          // Bounded in two directions at once. 22rem is the comfortable reading height; 34dvh
          // is what keeps the list, the filters and the caption all on screen at 690px tall,
          // which is the window this is actually read in.
          className="slab scroller max-h-[min(22rem,34dvh)] min-h-0 select-text divide-y divide-[var(--line)] overflow-y-auto rounded-[var(--r-lg)] bg-[var(--surface-1)] font-mono text-[11px] leading-relaxed"
        >
          {[...shown].reverse().map((entry) => (
            <li
              key={entry.id}
              className={`flex gap-2.5 border-l-2 px-2.5 py-1.5 ${LEVEL_RAIL[entry.level]}`}
            >
              <time
                dateTime={new Date(entry.at).toISOString()}
                className="shrink-0 tabular-nums text-[var(--fg-faint)]"
              >
                {stamp(entry.at)}
              </time>
              <span className={`w-10 shrink-0 font-bold ${LEVEL_TONE[entry.level]}`}>
                {entry.level}
              </span>
              <span
                className={`min-w-0 flex-1 break-words ${
                  entry.level === "info" ? "text-[var(--fg-dim)]" : "text-[var(--fg)]"
                }`}
              >
                {entry.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RELEASES: { title: string; when: string; changes: string[] }[] = [
  {
    title: "0.1.0",
    when: "17 August 2026",
    changes: [
      "Artists have real pages: a discography split into albums, EPs and singles.",
      "An artist's name finds the artist you meant, and an album plays from the track you clicked.",
      "One library, however you reach it — saved playlists no longer depend on the route.",
      "Search is quicker: songs and videos are looked up at the same time.",
      "Settings shows which build you are running.",
    ],
  },
  {
    title: "Nothing jumps on load",
    when: "16 August 2026",
    changes: [
      "Your theme, colour, avatar, name and counts are all back before the first frame.",
      "The profile picture no longer flickers, and the page reserves the space it will fill.",
      "A rejected picture says why it was rejected.",
      "Explore is in the sidebar; no player bar until you have played something.",
    ],
  },
  {
    title: "Explore, and Timbre as an installed app",
    when: "15 August 2026",
    changes: [
      "Explore: the charts and what to play next, on one page.",
      "Radio, and one page shape for every kind of list, with a play button that starts at the top.",
      "Search moved into a bar on every page, suggesting from what this browser has played.",
      "Timbre can be installed, opens off disk, and says so honestly when the network is gone.",
    ],
  },
  {
    title: "The charts",
    when: "14 August 2026",
    changes: [
      "A ranked chart with the evidence behind every position, and a ranking nobody publishes.",
      "Movement arrows, from where a song sat the last time you looked.",
      "Genre mix, a ranked bar chart, and a plot of where two sources disagree.",
      "Discover shelves, including a set for someone with no history at all.",
    ],
  },
  {
    title: "No accounts, and the first playable version",
    when: "10–13 August 2026",
    changes: [
      "Accounts and the database are gone: playlists, history and profile stay in this browser.",
      "Playlists with export and import, a local profile, and three themes.",
      "Lyrics beside the player, with a choice of version and a nudge for the timing.",
      "Search across several free sources at once, playing inside Timbre rather than linking out.",
      "When one copy of a track refuses to play, Timbre falls through to another.",
    ],
  },
];

function WhatsNew() {
  return (
    <>
      <Caption>
        Shipped with the build it describes — this is {VERSION}. The full list is in{" "}
        <a
          href={`${REPO}/blob/main/CHANGELOG.md`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[var(--fg-dim)] underline decoration-dotted hover:text-[var(--fg)]"
        >
          CHANGELOG.md
        </a>
        .
      </Caption>

      <Card className="mt-3 divide-y divide-[var(--line)]">
        {RELEASES.map((release) => (
          <article key={release.title} className="py-3.5 first:pt-0">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[var(--text-meta)] font-bold">{release.title}</h3>
              {release.title === process.env.NEXT_PUBLIC_TIMBRE_VERSION && (
                // --accent as a *fill* with --accent-fg on it: black on the pink measures
                // 6.99:1, where the pink as text on white is 2.60:1 and fails outright.
                <span
                  className="slab-sm rounded-[var(--r-full)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent-fg)]"
                  style={{ background: "var(--accent)" }}
                >
                  Installed
                </span>
              )}
              <span className="ml-auto shrink-0 text-[11px] text-[var(--fg-faint)]">
                {release.when}
              </span>
            </div>

            <ul className="mt-2 max-w-prose space-y-1.5 text-xs leading-relaxed text-[var(--fg-dim)]">
              {release.changes.map((change) => (
                <li key={change} className="flex gap-2">
                  <span aria-hidden="true" className="text-[var(--fg-faint)]">
                    —
                  </span>
                  {change}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </Card>
    </>
  );
}

function General() {
  const prefs = usePlaybackPrefs();

  return (
    <>
      <Caption>Saved in this browser, like everything else here.</Caption>

      <Card className="mt-3 divide-y divide-[var(--line)]">
        <Choice
          label="When the queue ends"
          detail="Keep going with songs like the last one, or stop where your queue stops."
          value={prefs.continueWithRadio}
          onChange={(value) => setPlaybackPref("continueWithRadio", value)}
          options={[
            { value: true, label: "Keep playing" },
            { value: false, label: "Stop" },
          ]}
        />
        <Choice
          label="Open the player on"
          detail="What the expanded player shows first. Songs with no lyrics say so."
          value={prefs.lyricsByDefault}
          onChange={(value) => setPlaybackPref("lyricsByDefault", value)}
          options={[
            { value: false, label: "Up next" },
            { value: true, label: "Lyrics" },
          ]}
        />
      </Card>
    </>
  );
}

function Choice({
  label,
  detail,
  value,
  onChange,
  options,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
  options: { value: boolean; label: string }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 first:pt-0"
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-[var(--text-meta)] font-bold">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--fg-dim)]">{detail}</p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.label}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={selected}
              className={`press rounded-[var(--r-full)] px-3 py-1.5 text-[12px] font-bold transition ${
                selected
                  ? "slab-sm text-[var(--accent-fg)]"
                  : "slab-ghost bg-[var(--surface-2)] text-[var(--fg-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
              }`}
              style={selected ? { background: "var(--accent)" } : undefined}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Notice({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${className} slab rounded-[var(--r-lg)] bg-[var(--surface-1)] px-4 py-5`.trim()}
    >
      <p className="text-[var(--text-meta)] font-bold">{title}</p>
      <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">{children}</p>
    </div>
  );
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(SECTIONS[0]);
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!open || !el) return;

    el.showModal();
    panel.current?.focus();

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      el.close();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur transition hover:bg-black/60"
      >
        <SettingsIcon className="size-4" />
      </button>

      <dialog
        ref={dialog}
        aria-modal="true"
        aria-label="Settings"
        onClose={() => setOpen(false)}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="fixed inset-0 size-full max-h-none max-w-none items-end justify-center overflow-hidden bg-transparent p-0 text-[var(--fg)] backdrop:bg-[rgb(0_0_0/50%)] backdrop:backdrop-blur-[8px] open:flex sm:items-center sm:p-6"
      >
        {open && (
          <div
            ref={panel}
            tabIndex={-1}
            // --bg, not --surface-1: the content column is the blush ground the white cards
            // sit on, which is the shape the references draw. The nav keeps its own pink.
            className="slab @container flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[var(--r-lg)] bg-[var(--bg)] outline-none sm:h-[32rem] sm:flex-row sm:rounded-[var(--r-lg)]"
          >
            <nav
              aria-label="Settings sections"
              className="shelf flex shrink-0 gap-1 overflow-x-auto border-b-2 border-[var(--ink)] bg-[var(--surface-2)] p-2 sm:w-[13.5rem] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r-2 sm:p-3"
            >
              {SECTIONS.map((entry) => {
                const selected = entry === active;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setActive(entry)}
                    aria-current={selected ? "true" : undefined}
                    className={`press flex shrink-0 items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-left text-[var(--text-meta)] font-semibold transition sm:w-full ${
                      selected
                        ? "slab-sm text-[var(--accent-fg)]"
                        : "slab-ghost text-[var(--fg-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
                    }`}
                    style={selected ? { background: "var(--accent)" } : undefined}
                  >
                    <entry.Icon className="size-4 shrink-0" />
                    {entry.label}
                  </button>
                );
              })}

              <div className="flex shrink-0 items-center gap-2.5 sm:mt-auto sm:px-1 sm:pt-4">
                <a
                  href={REPO}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Timbre on GitHub"
                  title="Timbre on GitHub"
                  className="press flex size-7 shrink-0 items-center justify-center rounded-[var(--r-md)] text-[var(--fg-faint)] transition hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
                >
                  <GithubIcon className="size-[18px]" />
                </a>
                <p className="whitespace-nowrap font-mono text-[11px] text-[var(--fg-faint)]">
                  {VERSION}
                </p>
              </div>
            </nav>

            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-1 pt-4 sm:px-6 sm:pt-5">
                <h2 className="text-[var(--text-title)] font-extrabold tracking-[var(--track-title)]">
                  {active.label}
                </h2>
                <button
                  type="button"
                  onClick={() => dialog.current?.close()}
                  aria-label="Close settings"
                  className="press -mr-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(1.25rem+var(--safe-b))] pt-2 sm:px-6 sm:pb-5">
                {active.render()}
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
