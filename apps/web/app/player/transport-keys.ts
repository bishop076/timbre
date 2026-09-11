const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);
const TYPING_ROLES = new Set(["button", "textbox", "link", "searchbox", "menuitem", "slider"]);

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

  const role = typeof element.getAttribute === "function" ? element.getAttribute("role") : null;
  return typeof role === "string" && TYPING_ROLES.has(role);
}

export type TransportAction = "toggle" | "next" | "previous" | "volume-up" | "volume-down";

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

export const VOLUME_STEP = 5;
