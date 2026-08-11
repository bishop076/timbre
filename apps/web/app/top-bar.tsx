"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CloseIcon, SearchIcon } from "./icons";
import { setSearchQuery, useSearchQuery } from "./search-store";
import { SearchSuggestions } from "./search-suggestions";
import { ProfileButton } from "./shell/sidebar";

/**
 * The search field, above the pages it belongs above.
 *
 * It used to belong to the search route, which meant reaching it was a
 * navigation: Home opened with shelves and no way to look anything up. Lifting
 * it into the shell fixed that, and **the field outliving the page is the
 * point, not an accident** — typing on Home navigates to the results on the
 * first keystroke, and because this input is mounted above the router it is
 * never remounted by that navigation. The caret stays, and the letters typed
 * during the transition land in the same box. An input owned by the results
 * page cannot do that; it would be created *by* the navigation it has to
 * survive.
 *
 * **Above every page was too far, though.** A playlist, an album, an artist and
 * the library are each *about one thing*, and a field sitting over them looks
 * like it searches within that thing — so typing in it and being thrown out to
 * a global result set reads as the box ignoring where you were. It was not
 * ignoring anything; it was the wrong control to have offered there.
 *
 * So it is drawn on the three routes where "find something in the catalogue" is
 * the natural next move. Home and Explore are places you arrive without a
 * target. Search is in the set because it *is* the results: dropping the field
 * there would leave no way to see or edit the query that produced them, and
 * would break the one flow this arrangement exists to protect — the field
 * surviving the navigation that typing triggers.
 *
 * Searching *inside* a playlist is a different feature and has its own, smaller
 * field on that page, filtering what is already there — see
 * `playlists/playlist-view.tsx`. One box that changed meaning by route would be
 * worse than either.
 */
const SEARCHABLE = new Set(["/", "/search", "/explore"]);

export function TopBar() {
  const query = useSearchQuery();
  const router = useRouter();
  const pathname = usePathname();
  const input = useRef<HTMLInputElement>(null);
  // Everything in the bar that is not the search field. Focus landing in here
  // must not open the suggestions — see the note on the wrapper below.
  const chrome = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [focused, setFocused] = useState(false);

  /*
   * The placeholder is chosen for the width rather than shortened by CSS.
   *
   * The long form is forty-eight characters; a phone shows about half of it and
   * cuts mid-word, which reads as broken rather than as truncated. Text cannot
   * be responsive in CSS, so the string itself changes.
   */
  useEffect(() => {
    const media = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  /*
   * `/` focuses the field — but only where there is one.
   *
   * The check is inside the handler rather than around the listener so it reads
   * the current route. Without it, pressing `/` on a playlist page swallowed
   * the keystroke to focus a field that is not displayed: no caret moved and
   * the character never arrived, which is the most annoying possible outcome
   * for someone who was simply typing.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key === "/" && !typing && SEARCHABLE.has(pathname)) {
        event.preventDefault();
        input.current?.focus();
      }
      if (event.key === "Escape" && typing) input.current?.blur();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pathname]);

  function change(value: string) {
    setSearchQuery(value);
    // Only ever *into* the results. Clearing the box does not navigate back:
    // the empty search page has its own suggestions, and yanking someone to
    // another route because they deleted a character is the kind of thing that
    // makes a field feel unsafe to edit.
    if (value.trim() && pathname !== "/search") router.push("/search");
  }

  /*
   * No field, no bar. Not "no field, an empty bar".
   *
   * This stood down only on the profile page at first, and everywhere else
   * kept the bar for the sake of the profile button in its corner. That left a
   * sticky strip carrying one small circle across the top of the library, every
   * playlist, every artist and every collection — no band behind it once that
   * was removed, so it hung over the first row of the page it was on and
   * collided with whatever sat top-right. On the library that is the Export
   * button.
   *
   * The profile is still one tap away from Home and Explore, which are the two
   * places a phone actually starts from, and the desktop rail carries it on
   * every page regardless.
   */
  const searchable = SEARCHABLE.has(pathname);
  if (!searchable) return null;

  return (
    <div className="sticky top-0 z-30 px-4 pb-2.5 pt-3 sm:px-7 sm:pb-3 sm:pt-4">
      {/*
        A full-viewport-width backdrop, centred and clipped by the panel's own
        overflow, so the band lands exactly on the panel edges at any width
        without needing to know what the content column is doing. `-mx-*` only
        reaches the edges of the max-width column, which left the band floating
        short of the panel on a wide screen.
      */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-md"
      />

      {/*
        Focus is tracked here rather than on the input, because the chips are
        inside this box too — `onBlur` on the field alone would close them
        before a click on one could land.

        But `onFocus` bubbles, and the profile button is inside this box as
        well. Tapping it therefore opened the suggestions on the way out: the
        chips appeared, the page grew by a row, and the tap landed on a target
        that had just moved — which on a phone is the difference between
        reaching your profile and not. Focus that starts outside the field is
        somebody on their way somewhere else, so it is ignored.
      */}
      <div
        className="mx-auto w-full max-w-6xl"
        onFocus={(event) => {
          if (chrome.current?.contains(event.target as Node)) return;
          setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-[var(--fg-dim)]" />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(event) => change(event.target.value)}
              placeholder={
                narrow
                  ? "Songs, artists, or a link…"
                  : "Search for a song, artist or mix — or paste a link…"
              }
              aria-label="Search for a song"
              /*
              Dark glass: one flat tone, no gradient.

              The *band* behind this takes the darkest step on the ramp, so the
              header reads as its own shelf rather than as more panel. The field
              then sits one step above it — enough to read as something you type
              into, still far below the `--surface-2` it briefly used when this
              moved into the shell, which made the field the *brightest* thing
              on the page on a dark ground and the flattest on a light one.
              Both are translucent so the cover wash carries through, and
              blurred so neither competes with the text.
            */
              className="slab slab-soft w-full rounded-[var(--r-lg)] bg-[color-mix(in_oklab,var(--surface-1)_78%,transparent)] py-2.5 pl-11 pr-12 text-[13px] font-medium outline-none backdrop-blur-md transition-colors placeholder:font-normal placeholder:text-[var(--fg-faint)] focus:bg-[var(--surface-1)] focus:shadow-[var(--drop-lg)] sm:text-[15px]"
            />

            {/* Ours rather than the browser's: `input[type=search]` draws a blue ✕
              in colours that cannot be themed, only removed — which globals.css
              does. The `/` hint takes the slot while the field is empty. */}
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  input.current?.focus();
                }}
                aria-label="Clear search"
                className="press absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-[var(--r-sm)] text-[var(--fg-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]"
              >
                <CloseIcon className="size-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-md border border-[var(--line)] px-1.5 py-0.5 font-mono text-xs text-[var(--fg-dim)] sm:block">
                /
              </kbd>
            )}
          </div>

          {/*
          The way into the profile on a phone, which has no rail to carry it.
          It used to sit at the top of Home alone, so it vanished on every other
          page — including the ones somebody lands on from a shelf and then
          wants to change a setting from.
        */}
          <div ref={chrome} className="shrink-0">
            <ProfileButton />
          </div>
        </div>

        {/*
          Suggestions push the page down rather than floating over it.

          A dropdown would cover the first thing on the page — on Explore that
          is the Featured row — so choosing a suggestion means obscuring the
          alternative to choosing one. In flow, both stay readable and nothing
          moves under the pointer except downwards.
        */}
        {focused && !query.trim() && (
          <div className="slab rise mt-2 rounded-[var(--r-lg)] bg-[var(--surface-1)] px-2.5 py-2 shadow-[var(--drop-lg)]">
            <SearchSuggestions />
          </div>
        )}
      </div>
    </div>
  );
}
