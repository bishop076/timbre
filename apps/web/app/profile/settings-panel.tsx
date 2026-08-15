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

/**
 * Fetched when the Appearance section is first opened.
 *
 * The picker carries every palette and its swatches, and it is the largest
 * thing in this panel by some way. The panel itself only renders behind a
 * button, and this is one section inside it — two clicks from the profile page
 * loading, which is far enough in that nobody is waiting on it.
 */
const ThemePicker = dynamic(() => import("../theme/theme-picker").then((m) => m.ThemePicker));

/** Where the source lives. */
const REPO = "https://github.com/bishop076/timbre";

/**
 * What is running, as a string.
 *
 * Both halves come from `next.config.ts` — see the note there. The commit is
 * empty in development and the label simply loses it rather than printing
 * "unknown", which is a word that looks like a fault rather than like a local
 * build with uncommitted changes in it.
 */
const VERSION = [
  `v${process.env.NEXT_PUBLIC_TIMBRE_VERSION ?? "0.0.0"}`,
  process.env.NEXT_PUBLIC_TIMBRE_COMMIT ? `(${process.env.NEXT_PUBLIC_TIMBRE_COMMIT})` : "",
]
  .filter(Boolean)
  .join(" ");

/**
 * Settings, behind one button.
 *
 * The theme picker used to sit open on the profile page, three cards wide and
 * most of a screen tall, between the header and the playlists. It is a control
 * most people touch once and then never again, and it was taking the best
 * position on the page to say so — pushing the playlists, which is what anybody
 * actually came here for, below the fold.
 *
 * **A rail of sections beside a pane, which is what settings look like.** Every
 * desktop application converges on this shape for the same reason: it is the
 * one arrangement where adding a tenth thing costs nothing. A stack of
 * disclosures grows downwards until nothing is findable, and a row of tabs runs
 * out of width at about five.
 *
 * Most of these sections are empty. That is deliberate — they are the shape the
 * panel is growing into, and retrofitting a rail later means moving every
 * control written on the assumption that this was a single column. Adding the
 * next one is an entry in `SECTIONS` and nothing else.
 *
 * A dialog rather than an inline disclosure, because settings are a detour.
 * Expanding in place would push the page around underneath somebody who is
 * about to change something, and the whole point of moving this was to stop
 * doing that.
 */

/**
 * The sections, in rail order.
 *
 * `render` rather than a component per entry, so a section that is three lines
 * of JSX does not need a file of its own to exist. When one grows past a
 * screenful it gets promoted to its own component and this still just calls it.
 */
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
    // A real apostrophe, not `&rsquo;` — this is a JavaScript string rendered
    // as a text node, so an entity here would show up on screen verbatim.
    label: "What’s New",
    Icon: SparkleIcon,
    render: () => <Planned>The changelog, shipped with the build it describes.</Planned>,
  },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

/**
 * The shortcuts, read off the code that implements them.
 *
 * Listed rather than configurable, because a rebinding UI has to store the
 * bindings, migrate them when a default changes, and cope with two actions
 * claiming one key — none of which is worth building before anybody has said
 * the defaults are wrong.
 *
 * The transport keys come from `player/transport-keys.ts`, which is unit-tested
 * and the single source of truth for them. This table has to be kept in step by
 * hand, which is the cost of not generating a UI from a switch statement.
 */
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

/**
 * A section that exists in the rail and not yet in the app.
 *
 * Deliberately not styled as a control anybody could mistake for a broken one:
 * it says what will be here rather than showing a disabled switch, because a
 * greyed-out toggle is a promise with a date on it and this is not.
 */
function Planned({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-5">
      <p className="text-[13px] font-bold">Not built yet</p>
      <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">{children}</p>
    </div>
  );
}

export function SettingsPanel() {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SectionId>(SECTIONS[0].id);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  /*
   * Escape closes, and focus goes back where it came from.
   *
   * Returning focus is not a nicety — opening this from the keyboard and
   * closing it otherwise drops the caret at the top of the document, so the
   * next Tab starts from the beginning of the page rather than from the button
   * that was just pressed.
   */
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

  /*
   * The page behind does not scroll while this is up.
   *
   * Without it a wheel over the backdrop scrolls the profile page, so closing
   * the panel returns you somewhere you never chose to be.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Focus moves into the panel so a keyboard reader is not left outside the
  // thing that just opened, and so Escape has somewhere to return from.
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
        /*
          The same control the banner's own buttons are: a circle of dark glass
          over the picture, sized and coloured to match, so the corner reads as
          one set of tools rather than as a page button that happened to land
          next to them.
        */
        className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-full)] bg-black/45 text-white backdrop-blur transition hover:bg-black/60"
      >
        <SettingsIcon className="size-4" />
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
            // A click on the backdrop and nowhere else. Checking the target is
            // the element itself rather than using a bubbled handler means a
            // drag that starts inside the panel and ends out here does not
            // count as a dismissal.
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            {/*
              A sheet on a phone, a window above it.

              **A definite height, not a maximum.** Sized to content, the dialog
              grew and shrank as you moved between sections — the rail jumped,
              the close button moved, and picking a theme after reading the
              shortcuts meant chasing a target that had just relocated. 32rem
              holds the longest section without scrolling and every shorter one
              without looking empty, so the frame is a fixed thing you navigate
              inside of, which is what a settings window is.

              The scroll lives on the *pane*, so the rail and the title stay put
              while a long section moves past them. That is the entire advantage
              of this arrangement over one tall column.
            */}
            <div
              ref={panel}
              role="dialog"
              aria-modal="true"
              aria-label="Settings"
              tabIndex={-1}
              className="slab @container flex max-h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[var(--r-lg)] bg-[var(--surface-1)] outline-none sm:h-[32rem] sm:flex-row sm:rounded-[var(--r-lg)]"
            >
              {/*
                The rail separates by *tone*, not by a rule.

                It had a border down its right and the header had one across the
                top, which met in a T a third of the way along — an arbitrary
                junction that belonged to neither. Giving the rail its own
                surface says the same thing with no line at all, and the header
                went away entirely: the pane titles itself, so a full-width bar
                repeating "Settings" above a rail that lists the sections was a
                third label for the same idea.

                A row of chips on a phone, a column on anything wider — the same
                trade the rankings rail makes. A vertical list above the content
                on a small screen would push the controls somebody came for off
                the bottom of the sheet.
              */}
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

                  {/*
                    Pinned to the foot of the rail on a wide screen, and simply
                    the last chip in the strip on a phone.

                    `mt-auto` rather than a spacer element: the rail is a flex
                    column with a definite height, so the margin does the whole
                    job and there is nothing extra in the tree to keep in step.
                    It is a no-op in the horizontal layout, which is exactly the
                    behaviour wanted there.
                  */}
                <div className="flex shrink-0 items-center gap-2.5 sm:mt-auto sm:px-1 sm:pt-4">
                  <a
                    href={REPO}
                    target="_blank"
                    // `noreferrer` alongside `noopener`: this opens a tab that
                    // would otherwise be handed a reference back to this one.
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

              {/*
                The pane titles itself and carries the close button, which is
                what let the header bar go. The title sits on the same baseline
                as the control, so the top of the pane is one row rather than a
                bar above a heading above content.
              */}
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
