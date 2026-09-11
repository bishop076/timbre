const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"]);
const TYPING_ROLES = new Set(["button", "textbox", "link", "searchbox", "menuitem", "slider"]);

type TransportAction = "toggle" | "next" | "previous" | "volume-up" | "volume-down";

const ACTIONS = new Map<string, TransportAction>([
  [" ", "toggle"],
  ["Spacebar", "toggle"],
  ["ArrowRight", "next"],
  ["ArrowLeft", "previous"],
  ["ArrowUp", "volume-up"],
  ["ArrowDown", "volume-down"],
]);

export const VOLUME_STEP = 5;

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

export function actionFor(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: unknown;
}): TransportAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return null;
  return ACTIONS.get(event.key) ?? null;
}
