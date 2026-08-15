const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);
const TYPING_ROLES = new Set(["button", "textbox", "link", "searchbox", "menuitem"]);

/**
 * Whether a keystroke belongs to the focused element: text entry, and buttons/links/selects
 * where Space and Enter already activate the control. Duck-typed rather than `instanceof
 * HTMLElement` — an element from another realm, such as the iframes this app mounts, is not
 * an instance of *this* realm's, and `instanceof` against a missing global throws.
 */
export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;

  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
    getAttribute?: (name: string) => string | null;
  };

  if (element.isContentEditable === true) return true;

  if (typeof element.tagName === "string" && TYPING_TAGS.has(element.tagName.toUpperCase())) {
    return true;
  }

  // A div playing the part of a button still owns Space and Enter.
  const role = typeof element.getAttribute === "function" ? element.getAttribute("role") : null;
  return typeof role === "string" && TYPING_ROLES.has(role);
}

export type TransportAction = "toggle" | "next" | "previous" | "volume-up" | "volume-down";

/**
 * Which action a keystroke means, or null for "not ours". Ctrl/Cmd/Alt chords belong to
 * the browser — `Cmd+←` is "go back" — but Shift alone forms no chord with these keys.
 * Left and right are track skips, not seeks: media keys reach the embedded iframe.
 */
export function actionFor(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}): TransportAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (isTypingTarget(event.target)) return null;

  switch (event.key) {
    // " " is the modern name; "Spacebar" is what older Firefox and Edge report.
    case " ":
    case "Spacebar":
      return "toggle";
    case "ArrowRight":
      return "next";
    case "ArrowLeft":
      return "previous";
    case "ArrowUp":
      return "volume-up";
    case "ArrowDown":
      return "volume-down";
    default:
      return null;
  }
}

/** How far one arrow press moves the volume, 0–100. */
export const VOLUME_STEP = 5;
