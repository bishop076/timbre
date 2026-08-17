"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { clearEverything } from "../clear-storage";
import {
  CloseIcon,
  GithubIcon,
  KeyboardIcon,
  LogsIcon,
  PaletteIcon,
  SettingsIcon,
  SparkleIcon,
  TrashIcon,
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
    render: () => <General />,
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
    render: () => <WhatsNew />,
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

/** What `clearEverything` takes, in the order someone would miss it. Spelled out rather
 * than summarised: "clear all data" is not consent if nobody said what the data was. */
const ERASES = [
  "Every playlist, and the songs saved into them",
  "Everything you have played, and the suggestions built from it",
  "Your display name, profile picture and banner",
  "Your theme, volume and lyrics preferences",
  "Remembered chart positions, and the offline copy of the app",
];

function General() {
  const [confirming, setConfirming] = useState(false);
  const [erasing, setErasing] = useState(false);

  return (
    <>
      <Planned>
        Playback and behaviour: what happens when a queue ends, and whether
        lyrics open by default.
      </Planned>

      <section
        aria-labelledby="erase-heading"
        className="mt-4 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-5"
      >
        <h3 id="erase-heading" className="text-[13px] font-bold text-red-400">
          Erase everything this browser is holding
        </h3>
        <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">
          Timbre has no account and no server. All of this lives in this browser and
          nowhere else, so there is no copy to put back afterwards.
        </p>

        <ul className="mt-3 max-w-prose space-y-1 text-xs leading-relaxed text-[var(--fg-dim)]">
          {ERASES.map((entry) => (
            <li key={entry} className="flex gap-2">
              <span aria-hidden="true" className="text-[var(--fg-faint)]">
                —
              </span>
              {entry}
            </li>
          ))}
        </ul>

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="press mt-4 flex items-center gap-2 rounded-[var(--r-sm)] bg-[var(--surface-3)] px-3 py-2 text-[12px] font-bold text-red-400 transition hover:bg-red-500/15"
          >
            <TrashIcon className="size-4 shrink-0" />
            Erase everything…
          </button>
        ) : (
          <div className="mt-4">
            <p role="alert" className="max-w-prose text-xs font-semibold leading-relaxed">
              This cannot be undone. Timbre will reload as a browser that has never
              opened it.
            </p>
            <div className="mt-2.5 flex gap-1.5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={erasing}
                className="press rounded-[var(--r-sm)] bg-[var(--surface-3)] px-3 py-2 text-[12px] font-semibold disabled:opacity-40"
              >
                Keep it
              </button>
              <button
                type="button"
                onClick={() => {
                  setErasing(true);
                  // Not awaited: it ends in `location.reload()`, so nothing here runs after.
                  void clearEverything();
                }}
                disabled={erasing}
                aria-label="Erase everything this browser is holding, permanently"
                className="slab-sm press flex items-center gap-2 rounded-[var(--r-sm)] bg-red-500/90 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-40"
              >
                <TrashIcon className="size-4 shrink-0" />
                {erasing ? "Erasing…" : "Erase everything"}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/** The headlines from `CHANGELOG.md`, newest first. Written out rather than parsed at
 * runtime: a markdown reader in the bundle costs more than these strings do. */
const RELEASES: { title: string; when?: string; changes: string[] }[] = [
  {
    title: "0.1.0",
    when: "17 August 2026",
    changes: [
      "Artists have real pages: a discography split into albums, singles and appearances.",
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
      <p className="text-xs leading-relaxed text-[var(--fg-faint)]">
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
      </p>

      <div className="mt-4 divide-y divide-[var(--line)]">
        {RELEASES.map((release) => (
          <section key={release.title} className="py-3.5 first:pt-0">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[13px] font-bold">{release.title}</h3>
              {release.title === process.env.NEXT_PUBLIC_TIMBRE_VERSION && (
                <span
                  className="rounded-[var(--r-full)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent-fg)]"
                  style={{ background: "var(--accent)" }}
                >
                  Installed
                </span>
              )}
              {release.when && (
                <span className="ml-auto shrink-0 text-[11px] text-[var(--fg-faint)]">
                  {release.when}
                </span>
              )}
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
          </section>
        ))}
      </div>
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
