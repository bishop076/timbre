"use client";

import type { RefObject } from "react";

import { CloseIcon, SearchIcon, SpinnerIcon } from "./icons";

/** The app's one search box: the queue's "add to queue" field and a playlist's filter are the
 * same control doing the same job, so they share it rather than each restating its chrome. */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder,
  label,
  clearLabel,
  busy = false,
  field,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder: string;
  label: string;
  clearLabel: string;
  busy?: boolean;
  field?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-[var(--r-md)] bg-[var(--surface-2)] px-2.5 py-1.5 focus-within:bg-[var(--surface-3)] ${className}`}
    >
      <SearchIcon className="size-4 shrink-0 text-[var(--fg-faint)]" />
      <input
        ref={field}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !value) return;
          // The panel closes on Escape, which is not what an Escape aimed at a full field means.
          event.stopPropagation();
          onClear();
        }}
        placeholder={placeholder}
        aria-label={label}
        className="min-w-0 flex-1 appearance-none bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-faint)] [&::-webkit-search-cancel-button]:appearance-none"
      />
      {busy && <SpinnerIcon className="size-3.5 shrink-0 text-[var(--fg-faint)]" />}
      {value !== "" && !busy && (
        <button
          type="button"
          onClick={onClear}
          aria-label={clearLabel}
          className="flex size-5 shrink-0 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] transition hover:bg-[var(--surface-1)] hover:text-[var(--fg)]"
        >
          <CloseIcon className="size-3.5" />
        </button>
      )}
    </div>
  );
}
