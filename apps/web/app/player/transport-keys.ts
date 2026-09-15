const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);

// Roles whose widget owns the keys Timbre would otherwise claim. `menuitem` alone was not
// enough: an anchored menu focuses its own `role="menu"` container whenever focus would
// otherwise fall to `<body>` — which is what happens the moment a menu opens with nothing in
// it — and from there Space toggled playback and the arrows moved the volume while the menu
// sat open. The rest are here for the same reason rather than on principle: Space belongs to
// a checkbox, a switch and an option, and the arrows belong to a listbox, a tab strip, a
// combobox and a spin button.
const TYPING_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "link",
  "listbox",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

type TransportAction = "toggle" | "next" | "previous" | "volume-up" | "volume-down";

const ACTIONS = new Map<string, TransportAction>([
  [" ", "toggle"],
  ["Spacebar", "toggle"],
  ["ArrowRight", "next"],
  ["ArrowLeft", "previous"],
  ["ArrowUp", "volume-up"],
  ["ArrowDown", "volume-down"],
]);

// Held keys that mean "keep going". Volume is a ramp, so its repeats are the point; the other
// three are one-shot, and taking their repeats meant a leant-on space bar strobed play/pause
// and a leant-on arrow walked the whole queue.
const RAMPS = new Set<TransportAction>(["volume-up", "volume-down"]);

export const VOLUME_STEP = 5;

export interface TransportEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  repeat: boolean;
  target: unknown;
}

export interface Transport {
  toggle: () => void;
  next: () => void;
  previous: () => void;
  setVolume: (level: number) => void;
  volume: number;
}

export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;

  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };
  return (
    element.isContentEditable === true ||
    (typeof element.tagName === "string" && TYPING_TAGS.has(element.tagName.toUpperCase())) ||
    (typeof element.getAttribute === "function" &&
      TYPING_ROLES.has(element.getAttribute("role") ?? ""))
  );
}

export function actionFor(event: TransportEvent): TransportAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return null;
  const action = ACTIONS.get(event.key) ?? null;
  return action && event.repeat && !RAMPS.has(action) ? null : action;
}

/**
 * Runs the shortcut, and reports whether Timbre took the key.
 *
 * The caller suppresses the browser's own use of every key this claims, volume included. The
 * volume arrows used to fall through: they set the volume *and* scrolled the page behind the
 * player, so turning the music down walked the page away under you.
 */
export function runTransport(event: TransportEvent, transport: Transport | null): boolean {
  const action = actionFor(event);
  if (!action || !transport) return false;

  if (action === "volume-up") transport.setVolume(transport.volume + VOLUME_STEP);
  else if (action === "volume-down") transport.setVolume(transport.volume - VOLUME_STEP);
  else transport[action]();
  return true;
}
