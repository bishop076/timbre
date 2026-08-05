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

/** Home. A roof and a door, which is the shape everyone reads instantly. */
export function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M3.5 10.5 12 3.5l8.5 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.75 20v-5.5h4.5V20" strokeLinecap="round" strokeLinejoin="round" />
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

export function VolumeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path
        d="M11 4.6 6.5 8.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.5l4.5 3.9V4.6Z"
        fill="currentColor"
        strokeLinejoin="round"
      />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" strokeLinecap="round" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" strokeLinecap="round" />
    </svg>
  );
}

/** Muted — the same speaker, waves struck out. */
export function VolumeMuteIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path
        d="M11 4.6 6.5 8.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.5l4.5 3.9V4.6Z"
        fill="currentColor"
        strokeLinejoin="round"
      />
      <path d="m15.5 10 5 4M20.5 10l-5 4" strokeLinecap="round" />
    </svg>
  );
}

/** Clears the search box. Replaces the browser's unthemeable blue one. */
export function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className} aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

export function ShuffleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M4 6h3.5c1.2 0 2.3.6 3 1.6l4 6c.7 1 1.8 1.6 3 1.6H21" strokeLinecap="round" />
      <path d="M4 18h3.5c1.2 0 2.3-.6 3-1.6l.6-1M14 8l.4-.6c.7-1 1.8-1.4 3-1.4H21" strokeLinecap="round" />
      <path d="m18.5 3 2.5 3-2.5 3M18.5 12l2.5 3-2.5 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Repeat the queue. {@link RepeatOneIcon} is the same loop with a 1 in it. */
export function RepeatIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M7 7h10a3 3 0 0 1 3 3v1" strokeLinecap="round" />
      <path d="M17 17H7a3 3 0 0 1-3-3v-1" strokeLinecap="round" />
      <path d="m9 4-3 3 3 3M15 20l3-3-3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RepeatOneIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M7 7h10a3 3 0 0 1 3 3v1" strokeLinecap="round" />
      <path d="M17 17H7a3 3 0 0 1-3-3v-1" strokeLinecap="round" />
      <path d="m9 4-3 3 3 3M15 20l3-3-3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.6 10.8 13 10v4.5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
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

export function MailIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Add to the play queue — a list with a plus.
 *
 * Deliberately not {@link PlusIcon}. Song rows carry both actions side by side,
 * and two identical plus buttons on one row is a coin toss over which one adds
 * to a playlist and which one queues.
 */
export function QueueAddIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M4 6h12M4 12h12M4 18h7" strokeLinecap="round" />
      <path d="M17.5 14.5v6M14.5 17.5h6" strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M4 7h16M10 7V5h4v2M6 7l1 12h10l1-12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9Z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

/** Overflow menu — the affordance for actions that are not the primary one. */
export function MoreIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20Z" strokeLinejoin="round" />
      <path d="m14.5 6.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={className} aria-hidden>
      <path d="m5 13 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Save to a playlist — lines with a plus.
 *
 * Distinct from a bare {@link PlusIcon}, which means "add to queue". The two
 * sit on the same tile and a shared glyph made them indistinguishable; the
 * lines say *a list* is being added to, which is the difference.
 */
export function PlaylistAddIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="M4 7h12M4 12h12M4 17h7" strokeLinecap="round" />
      <path d="M18 15v6M15 18h6" strokeLinecap="round" />
    </svg>
  );
}
