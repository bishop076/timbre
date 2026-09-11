"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CloseIcon, SearchIcon } from "./icons";
import { setSearchQuery, useSearchQuery } from "./search-store";
import { SearchSuggestions } from "./search-suggestions";
import { ProfileButton } from "./shell/sidebar";

const SEARCHABLE = new Set(["/", "/search", "/explore"]);

export function TopBar() {
  const query = useSearchQuery();
  const router = useRouter();
  const pathname = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const early = input.current?.value;
    if (early && !query) change(early);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (value.trim() && pathname !== "/search") router.push("/search");
  }

  if (!SEARCHABLE.has(pathname)) return null;

  return (
    <div className="sticky top-0 z-30 px-4 pb-2.5 pt-3 sm:px-7 sm:pb-3 sm:pt-4">
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-md"
      />

      <div
        className="mx-auto w-full max-w-6xl"
        onFocus={(event) => {
          if (!chrome.current?.contains(event.target as Node)) setFocused(true);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[18px] -translate-y-1/2 text-[var(--fg-dim)]" />
            <input
              ref={input}
              type="search"
              value={query}
              onChange={(event) => change(event.target.value)}
              placeholder=" "
              aria-label="Search for a song"
              className="peer slab slab-soft w-full rounded-[var(--r-lg)] bg-[color-mix(in_oklab,var(--surface-1)_78%,transparent)] py-2.5 pl-11 pr-12 text-[13px] font-medium outline-none backdrop-blur-md transition-colors focus:bg-[var(--surface-1)] focus:shadow-[var(--drop-lg)] sm:text-[15px]"
            />

            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-11 right-12 hidden items-center text-[13px] text-[var(--fg-faint)] peer-placeholder-shown:flex sm:text-[15px]"
            >
              <span className="truncate sm:hidden">Songs, artists, or a link…</span>
              <span className="hidden truncate sm:inline">
                Search for a song, artist or mix — or paste a link…
              </span>
            </span>

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

          <div ref={chrome} className="shrink-0">
            <ProfileButton />
          </div>
        </div>

        {focused && !query.trim() && (
          <div className="slab rise mt-2 rounded-[var(--r-lg)] bg-[var(--surface-1)] px-2.5 py-2 shadow-[var(--drop-lg)]">
            <SearchSuggestions />
          </div>
        )}
      </div>
    </div>
  );
}
