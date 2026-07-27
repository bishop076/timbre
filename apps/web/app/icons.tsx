/**
 * Inline icons.
 *
 * Hand-rolled rather than pulled from an icon package: six small paths are not
 * worth a dependency, and inlining keeps them themeable with currentColor.
 */

type IconProps = { className?: string };

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M14 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 4 11 13" strokeLinecap="round" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" />
    </svg>
  );
}

export function NoteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20 3.5a1 1 0 0 0-1.2-.98l-9 1.9A1 1 0 0 0 9 5.4v9.28A3.5 3.5 0 1 0 11 17.8V9.32l7-1.48v4.34A3.5 3.5 0 1 0 20 15V3.5Z" />
    </svg>
  );
}

export function LibraryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M4 4v16M9 4v16" strokeLinecap="round" />
      <path d="m14.5 5.5 4.2 15" strokeLinecap="round" />
    </svg>
  );
}

export function PrevIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M7 5a1 1 0 0 1 2 0v5.2l8.5-5.06A1 1 0 0 1 19 6v12a1 1 0 0 1-1.5.86L9 13.8V19a1 1 0 0 1-2 0V5Z" />
    </svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17 5a1 1 0 0 0-2 0v5.2L6.5 5.14A1 1 0 0 0 5 6v12a1 1 0 0 0 1.5.86L15 13.8V19a1 1 0 0 0 2 0V5Z" />
    </svg>
  );
}

/** Shows the video surface. Paired with {@link VideoOffIcon} as a toggle. */
export function VideoIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 12 5-3.2v6.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Hides the video surface — the same shape, struck through. */
export function VideoOffIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 12 5-3.2v6.4z" fill="currentColor" stroke="none" />
      <path d="M3 21 21 3" strokeLinecap="round" />
    </svg>
  );
}

/** Expands the video to fill the content area. */
export function ExpandIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M14 4h6v6M20 4l-7 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 20H4v-6M4 20l7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Puts the expanded video back in the panel — the same arrows, reversed. */
export function CollapseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M20 10h-6V4M13 11l7-7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14h6v6M11 13l-7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={className} aria-hidden>
      <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" />
    </svg>
  );
}
