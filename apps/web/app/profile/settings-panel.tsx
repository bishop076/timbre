"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import {
  CloseIcon,
  GithubIcon,
  KeyboardIcon,
  LogsIcon,
  NoteIcon,
  PaletteIcon,
  SettingsIcon,
  SparkleIcon,
  TrashIcon,
} from "../icons";
import { clearLogs, useLogs, type LogLevel } from "../logs.ts";
import { SpotifyConnect } from "../spotify/connect-panel";

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
        Playback and behaviour: what happens when a queue ends, and whether lyrics open by
        default.
      </Planned>
    ),
  },
  {
    id: "sources",
    label: "Sources",
    Icon: NoteIcon,
    render: () => <SpotifyConnect />,
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
    render: () => <Logs />,
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

const LEVEL_TONE: Record<LogLevel, string> = {
  info: "text-[var(--fg-faint)]",
  warn: "text-amber-500",
  error: "text-red-400",
};

/** 24-hour, since a log read against a clock wants no am/pm to parse. */
function stamp(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

/** `app/logs.ts`, newest first. */
function Logs() {
  const entries = useLogs();

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-prose text-xs leading-relaxed text-[var(--fg-faint)]">
          Which sources answered, which refused, and why a track fell back to another
          copy of itself. This tab only — none of it is written anywhere, and closing
          the tab loses it.
        </p>
        <button
          type="button"
          onClick={clearLogs}
          disabled={entries.length === 0}
          className="press flex shrink-0 items-center gap-2 rounded-[var(--r-sm)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-semibold transition hover:bg-[var(--surface-3)] disabled:opacity-40"
        >
          <TrashIcon className="size-4 shrink-0" />
          Clear
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="mt-4 rounded-[var(--r-lg)] bg-[var(--surface-2)] px-4 py-5">
          <p className="text-[13px] font-bold">Nothing has happened yet</p>
          <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-[var(--fg-dim)]">
            Search for something, or play a track, and what each source said turns up here.
          </p>
        </div>
      ) : (
        <ul
          aria-label="Log entries, newest first"
          className="scroller mt-4 max-h-80 divide-y divide-[var(--line)] overflow-y-auto rounded-[var(--r-lg)] bg-[var(--surface-2)] p-1 font-mono text-[11px] leading-relaxed"
        >
          {[...entries].reverse().map((entry) => (
            <li key={entry.id} className="flex gap-2.5 px-2.5 py-2">
              <time
                dateTime={new Date(entry.at).toISOString()}
                className="shrink-0 tabular-nums text-[var(--fg-faint)]"
              >
                {stamp(entry.at)}
              </time>
              <span className={`w-9 shrink-0 font-bold ${LEVEL_TONE[entry.level]}`}>
                {entry.level}
              </span>
              <span className="min-w-0 flex-1 break-words text-[var(--fg-dim)]">
                {entry.message}
              </span>
            </li>
          ))}
        </ul>
      )}
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
  const dialog = useRef<HTMLDialogElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const active = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0];

  // `showModal()` is where the top layer, the `::backdrop`, Escape, the focus trap and focus
  // back to the trigger come from. Not the scroll lock: no engine blocks the document for
  // `dialog:modal`, and a wheel over the backdrop would move the page behind it.
  useEffect(() => {
    const el = dialog.current;
    if (!open || !el) return;

    el.showModal();
    // Or the dialog focusing steps land on the first rail button and ring it.
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

      {/* `open:flex`, not `flex`: an author `display` beats the UA's
          `dialog:not([open]) { display: none }` and would leave this over the page.
          `::backdrop` does not inherit at this project's floor, so its tint is literal. */}
      <dialog
        ref={dialog}
        aria-modal="true"
        aria-label="Settings"
        // Every close goes through the element and comes back as `close`, so the dialog is
        // already hidden by the time React drops the panel.
        onClose={() => setOpen(false)}
        // Target-checked, so a drag ending out here is not a dismissal.
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="fixed inset-0 size-full max-h-none max-w-none items-end justify-center overflow-hidden bg-transparent p-0 text-[var(--fg)] backdrop:bg-[rgb(0_0_0/50%)] backdrop:backdrop-blur-[8px] open:flex sm:items-center sm:p-6"
      >
        {/* A definite 32rem height, not a maximum: sized to content the dialog grew
            and shrank between sections, so the rail jumped and the close button moved
            out from under the pointer. The scroll lives on the pane. */}
        {open && (
          <div
            ref={panel}
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
                  onClick={() => dialog.current?.close()}
                  aria-label="Close settings"
                  className="press -mr-1 flex size-8 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-faint)] transition hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
                >
                  <CloseIcon className="size-4" />
                </button>
              </div>

              {/* The sheet is flush to the bottom of the screen on a phone, so the home
                  indicator lies over the end of this pane — the inset goes on the padding
                  rather than on the sheet, which would leave a strip of blurred backdrop
                  under a panel that is meant to look anchored. From `sm` the dialog is
                  centred and floating, where the inset is simply wrong. */}
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
