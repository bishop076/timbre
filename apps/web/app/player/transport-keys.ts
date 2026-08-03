/**
 * Should a keystroke be left alone?
 *
 * Separated from the hook so the rule can be tested without a DOM tree or a
 * React render, because getting it wrong is silent and awful in both
 * directions: too eager and typing a space into the search box pauses the
 * music, too shy and the shortcuts never fire.
 *
 * Three categories are left alone:
 *
 * - **Text entry** — inputs, textareas and anything `contenteditable`. A space
 *   there is a space.
 * - **Buttons, links and selects** — Space and Enter already activate a focused
 *   control, and stealing Space would break every one of them for keyboard
 *   users. This is why a focused play button still works normally.
 * - **Modified chords** — Ctrl/Cmd/Alt combinations belong to the browser and
 *   the operating system. `Cmd+←` is "go back", not "previous track".
 *
 * Shift alone is not a modifier here: it cannot form a browser chord with these
 * keys, and reserving it would only make Shift+Space fail for no reason.
 *
 * Duck-typed rather than `instanceof HTMLElement`, for two reasons. An element
 * belonging to another realm — anything inside one of the several iframes this
 * app mounts — is not an instance of *this* realm's `HTMLElement` and would
 * wrongly pass. And `instanceof` against a global that does not exist throws,
 * which makes the rule untestable outside a browser.
 */
const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);
const TYPING_ROLES = new Set(["button", "textbox", "link", "searchbox", "menuitem"]);

// `unknown` rather than `EventTarget`, because that is the truth: this inspects
// whatever it is handed and never calls an EventTarget method. Narrowing the
// parameter would be a claim the implementation does not make, and would force
// every caller holding a plain object to cast through `unknown` anyway.
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

  // Custom controls that took over a native role — a div playing the part of a
  // button still owns Space and Enter.
  const role = typeof element.getAttribute === "function" ? element.getAttribute("role") : null;
  return typeof role === "string" && TYPING_ROLES.has(role);
}

export type TransportAction = "toggle" | "next" | "previous" | "volume-up" | "volume-down";

/**
 * Which action a keystroke means, or null for "not ours".
 *
 * Left and right are **track skips**, not seeks. That is the requirement from
 * docs/PLAN.md: media keys reach the embedded iframe rather than Timbre's
 * queue, so a keyboard route to next/previous is the only one there is. Seeking
 * has a visible scrubber; skipping had nothing.
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
