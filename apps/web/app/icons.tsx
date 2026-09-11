type IconProps = { className?: string };

const stroked = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const filled = { viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true } as const;

export function SearchIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function NoteIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <path d="M20 3.5a1 1 0 0 0-1.2-.98l-9 1.9A1 1 0 0 0 9 5.4v9.28A3.5 3.5 0 1 0 11 17.8V9.32l7-1.48v4.34A3.5 3.5 0 1 0 20 15V3.5Z" />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.75 20v-5.5h4.5V20" />
    </svg>
  );
}

export function LibraryIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><path d="M4 4v16M9 4v16" /><path d="m14.5 5.5 4.2 15" /></svg>;
}

export function PrevIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <path d="M7 5a1 1 0 0 1 2 0v5.2l8.5-5.06A1 1 0 0 1 19 6v12a1 1 0 0 1-1.5.86L9 13.8V19a1 1 0 0 1-2 0V5Z" />
    </svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <path d="M17 5a1 1 0 0 0-2 0v5.2L6.5 5.14A1 1 0 0 0 5 6v12a1 1 0 0 0 1.5.86L15 13.8V19a1 1 0 0 0 2 0V5Z" />
    </svg>
  );
}

export function VideoIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 12 5-3.2v6.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function VideoOffIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <rect x="2.5" y="6" width="13" height="12" rx="2.5" />
      <path d="m15.5 12 5-3.2v6.4z" fill="currentColor" stroke="none" />
      <path d="M3 21 21 3" />
    </svg>
  );
}

export function VolumeIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M11 4.6 6.5 8.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.5l4.5 3.9V4.6Z" fill="currentColor" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  );
}

export function VolumeMuteIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M11 4.6 6.5 8.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.5l4.5 3.9V4.6Z" fill="currentColor" />
      <path d="m15.5 10 5 4M20.5 10l-5 4" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return <svg {...stroked} strokeWidth={2.2} className={className}><path d="M6 6l12 12M18 6 6 18" /></svg>;
}

export function ShuffleIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M4 6h3.5c1.2 0 2.3.6 3 1.6l4 6c.7 1 1.8 1.6 3 1.6H21" strokeLinejoin="miter" />
      <path d="M4 18h3.5c1.2 0 2.3-.6 3-1.6l.6-1M14 8l.4-.6c.7-1 1.8-1.4 3-1.4H21" strokeLinejoin="miter" />
      <path d="m18.5 3 2.5 3-2.5 3M18.5 12l2.5 3-2.5 3" />
    </svg>
  );
}

export function RepeatIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M7 7h10a3 3 0 0 1 3 3v1" />
      <path d="M17 17H7a3 3 0 0 1-3-3v-1" />
      <path d="m9 4-3 3 3 3M15 20l3-3-3-3" />
    </svg>
  );
}

export function RepeatOneIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M7 7h10a3 3 0 0 1 3 3v1" />
      <path d="M17 17H7a3 3 0 0 1-3-3v-1" />
      <path d="m9 4-3 3 3 3M15 20l3-3-3-3" />
      <path d="M11.6 10.8 13 10v4.5" strokeWidth="2.2" />
    </svg>
  );
}

export function ExpandIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M14 4h6v6M20 4l-7 7" />
      <path d="M10 20H4v-6M4 20l7-7" />
    </svg>
  );
}

export function CollapseIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M20 10h-6V4M13 11l7-7" />
      <path d="M4 14h6v6M11 13l-7 7" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><path d="m6 9 6 6 6-6" /></svg>;
}

export function SpinnerIcon({ className }: IconProps) {
  return <svg {...stroked} strokeWidth={2.5} className={className}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
}

export function PlusIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><path d="M12 5v14M5 12h14" /></svg>;
}

export function QueueAddIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M4 6h12M4 12h12M4 18h7" />
      <path d="M17.5 14.5v6M14.5 17.5h6" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><path d="M4 7h16M10 7V5h4v2M6 7l1 12h10l1-12" /></svg>;
}

export function CameraIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2.2l1.2-2h8.2l1.2 2h2.2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9Z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M4 20h4L19 9a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5V20Z" />
      <path d="m14.5 6.5 3 3" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return <svg {...stroked} strokeWidth={2.5} className={className}><path d="m5 13 4 4 10-10" /></svg>;
}

export function PlaylistAddIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><path d="M4 7h12M4 12h12M4 17h7" /><path d="M18 15v6M15 18h6" /></svg>;
}

export function CompassIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.2 8.8-1.9 4.5-4.5 1.9z" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function PaletteIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M12 3a9 9 0 1 0 0 18c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1a1.49 1.49 0 0 1 1.09-2.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8z" />
      <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="11" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function KeyboardIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </svg>
  );
}

export function LogsIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v5h5M8 13h8M8 17h5" strokeLinejoin="miter" />
    </svg>
  );
}

export function SparkleIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8L12 3z" />
      <path d="M18.5 15l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4z" />
    </svg>
  );
}

export function GithubIcon({ className }: IconProps) {
  return (
    <svg {...filled} className={className}>
      <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.03 10.03 0 0 0 22 12.25C22 6.58 17.52 2 12 2z" />
    </svg>
  );
}

const HEART =
  "M12 20s-7-4.35-9-9.1C1.7 7.6 3.7 4.5 7 4.5c2.1 0 3.8 1.2 5 3 1.2-1.8 2.9-3 5-3 3.3 0 5.3 3.1 4 6.4-2 4.75-9 9.1-9 9.1z";

export function HeartIcon({ className }: IconProps) {
  return <svg {...stroked} className={className}><path d={HEART} /></svg>;
}

export function HeartFilledIcon({ className }: IconProps) {
  return <svg {...stroked} fill="currentColor" className={className}><path d={HEART} /></svg>;
}

export function SpeedIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
      <path d="m12 14 4-4" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  );
}

export function PlayHereIcon({ className }: IconProps) {
  return (
    <svg {...stroked} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 8.5h18M12 11.5v5.5M9.25 14.25 12 17l2.75-2.75" />
    </svg>
  );
}
