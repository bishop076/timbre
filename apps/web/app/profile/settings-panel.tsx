"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CloseIcon,
  GithubIcon,
  KeyboardIcon,
  LogsIcon,
  PaletteIcon,
  SettingsIcon,
  SparkleIcon,
} from "../icons";

// Fetched when Appearance is first opened; the picker is the largest thing here.
const ThemePicker = dynamic(() => import("../theme/theme-picker").then((m) => m.ThemePicker));

const REPO = "https://github.com/bishop076/timbre";

/** What is running. Both halves come from `next.config.ts`; the commit is empty in
 * development and the label drops it rather than printing "unknown". */
const VERSION = [
  `v${process.env.NEXT_PUBLIC_TIMBRE_VERSION ?? "0.0.0"}`,
  process.env.NEXT_PUBLIC_TIMBRE_COMMIT ? `(${process.env.NEXT_PUBLIC_TIMBRE_COMMIT})` : "",
]
  .filter(Boolean)
  .join(" ");

/** The sections, in rail order. `render` rather than a component per entry, so a
 * three-line section needs no file of its own. */
const SECTIONS = [
  {
    id: "general",
    label: "General",
    Icon: SettingsIcon,
    render: () => (
      <Planned>
        Playback and behaviour: what happens when a queue ends, whether lyrics
        open by default, and a way to erase everything this browser is holding.
      </Planned>
    ),
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    Icon: KeyboardIcon,
    render: () => <Shortcuts />,
  },
  {
    id: "appearance",
    label: "Themes",
    Icon: PaletteIcon,
    render: () => <ThemePicker />,
  },
  {
    id: "logs",
    label: "Logs",
    Icon: LogsIcon,
    render: () => (
      <Planned>
        What the sources actually said — which of them answered, which refused,
        and why a track fell back to another copy of itself. Kept in memory for
        this tab only.
      </Planned>
    ),
  },
  {
    id: "whats-new",
    // A real apostrophe, not `&rsquo;`: this is a string rendered as a text node, so an
    // entity would show up on screen verbatim.
    label: "What’s New",
    Icon: SparkleIcon,
    render: () => <Planned>The changelog, shipped with the build it describes.</Planned>,
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/** The shortcuts, listed rather than configurable. Implemented in
 * `player/transport-keys.ts` — this table is kept in step by hand. */
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
      <p className="text-xs leading-relaxed text-[var(--fg-faint)]">
        Ignored while you are typing, and whenever a modifier is held — so these
        never take a key another application wanted.
      </p>

      <ul className="mt-4 divide-y divide-[var(--line)]">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.action} className="flex items-center gap-4 py-2.5">
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
            <span className="min-w-0 flex-1 text-[13px] font-medium">{shortcut.action}</span>
            {shortcut.note && (
              <span className="shrink-0 text-[11px] text-[var(--fg-faint)]">{shortcut.note}</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** A rail section not yet built. Says what will be here rather than showing a
 * disabled switch nobody could tell from a broken one. */
function Planned({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-5">
      <p className="text-[13px] font-bold">Not built yet</p>
      <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">{children}</p>
    </div>
  );
}

/** Settings, behind one button — a rail of sections beside a pane, in a dialog. */
export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SectionId>(SECTIONS[0].id);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  // Focus returns to the trigger, or the next Tab starts from the top of the document.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // A wheel over the backdrop would move the page behind, so closing would return you
  // somewhere you never chose.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Settings"
        className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur transition hover:bg-black/60"
      >
        <SettingsIcon className="size-4" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
            // Target-checked, so a drag ending out here is not a dismissal.
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            {/* A definite 32rem height, not a maximum: sized to content the dialog grew
                and shrank between sections, so the rail jumped and the close button moved
                out from under the pointer. The scroll lives on the pane. */}
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              tabIndex={-1}
              className="slab @container flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[var(--r-lg)] bg-[var(--surface-1)] outline-none sm:h-[32rem] sm:flex-row sm:rounded-[var(--r-lg)]"
            >
              {/* Separated by tone, not a rule. A row of chips on a phone, since a
                  vertical list above the content would push the controls off the
                  bottom of the sheet. */}
              <nav
                aria-label="Settings sections"
                className="shelf flex shrink-0 gap-1 overflow-x-auto bg-[var(--surface-2)] p-2 sm:w-[13.5rem] sm:flex-col sm:overflow-visible sm:p-3"
              >
                  {SECTIONS.map((entry) => {
                    const selected = entry.id === active.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSection(entry.id)}
                        aria-current={selected ? "true" : undefined}
                        className={`press flex shrink-0 items-center gap-2.5 rounded-[var(--r-md)] px-3 py-2 text-left text-[13px] font-semibold transition sm:w-full ${
                          selected
                            ? "slab-sm text-[var(--accent-fg)]"
                            : "text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                        }`}
                        style={selected ? { background: "var(--accent)" } : undefined}
                      >
                        <entry.Icon className="size-4 shrink-0" />
                        {entry.label}
                      </button>
                    );
                  })}

                  {/* `mt-auto` rather than a spacer element, and a no-op in the
                      horizontal layout. */}
                <div className="flex shrink-0 items-center gap-2.5 sm:mt-auto sm:px-1 sm:pt-4">
                  <a
                    href={REPO}
                    target="_blank"
                    // `noreferrer` too, or the new tab gets a reference back to this one.
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
                  <h2 className="text-xl font-extrabold tracking-tight">{active.label}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      trigger.current?.focus();
                    }}
                    aria-label="Close settings"
                    className="press -mr-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                  >
                    <CloseIcon className="size-4" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2 sm:px-6">
                  {active.render()}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
