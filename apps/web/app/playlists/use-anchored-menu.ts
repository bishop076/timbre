"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import { menuTarget, tabTarget, typeaheadQuery, typeaheadTarget } from "./menu-keys";

const WIDTH = 240;
const MARGIN = 8;
const UNPLACED: CSSProperties = { left: 0, top: 0, visibility: "hidden" };

/**
 * Everything Tab can land on inside an open menu. `[tabindex="-1"]` is excluded so the menu's own
 * container is not a stop of its own, but the items are: they carry `tabindex="-1"` by then and
 * are still reached, because the trap moves focus itself rather than letting the browser do it.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
  '[role="menuitem"]:not(:disabled)',
].join(",");

const MENUITEM = '[role="menuitem"]';

/** A disabled item cannot take focus, so it cannot be arrowed to either. */
function itemsIn(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENUITEM)].filter(
    (item) => !item.matches(":disabled") && item.getAttribute("aria-disabled") !== "true",
  );
}

function isTyping(node: HTMLElement): boolean {
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

/**
 * One item in the tab order and the rest at `tabindex="-1"` — the roving pattern, applied to the
 * live DOM rather than to props.
 *
 * It has to be the DOM because the items are not this hook's to render: they are four different
 * components' JSX, and half of them come and go while the menu is open — playlists finish
 * loading, the item for a picture that was just removed leaves. The markup declares
 * `tabIndex={-1}`, which is what the first paint needs, and this promotes one of them.
 */
function rove(items: HTMLElement[], active: Element | null): void {
  const chosen = active instanceof HTMLElement && items.includes(active) ? active : items[0];
  for (const item of items) item.tabIndex = item === chosen ? 0 : -1;
}

/**
 * APG menu keyboard behaviour for any `role="menu"` — arrows, Home/End, typeahead and a Tab trap
 * — attached to the menu element itself, so every menu in the app inherits it from one place
 * instead of each growing its own half of it.
 *
 * The arrow half deliberately does nothing when the panel holds no `role="menuitem"`: the
 * playback panel is a `role="dialog"` of toggle buttons that governs its own arrow keys, and
 * shares this hook only for the placement and the Escape below. It does take the Tab trap, which
 * is what a dialog wants anyway.
 *
 * `returnFocus` is for the one menu with no trigger to return to — the right-click menu, which
 * has to remember what held focus before the pointer opened it. The anchored menus hand focus
 * back in `close()` instead, while the element taking it is still on the page.
 */
export function useMenuKeyboard(
  menu: RefObject<HTMLElement | null>,
  open: boolean,
  { returnFocus = false }: { returnFocus?: boolean } = {},
): void {
  useEffect(() => {
    const node = menu.current;
    if (!open || !node) return;

    const opener = document.activeElement as HTMLElement | null;
    let query = "";
    let typedAt = 0;

    const land = (item: HTMLElement | undefined) => {
      if (!item) return;
      rove(itemsIn(node), item);
      item.focus({ preventScroll: true });
      item.scrollIntoView({ block: "nearest" });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;

      // The trap comes first, and applies inside a text field too: a Tab out of the rename box
      // would otherwise leave the menu open with focus somewhere further down the page.
      if (event.key === "Tab") {
        const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const to = tabTarget(stops.indexOf(target), stops.length, event.shiftKey);
        if (to === null) return;
        event.preventDefault();
        stops[to]?.focus({ preventScroll: true });
        return;
      }

      const items = itemsIn(node);
      // Typing in the new-playlist field is typing, not typeahead, and Home in it is the start
      // of the line.
      if (items.length === 0 || isTyping(target)) return;

      const from = items.indexOf(target.closest<HTMLElement>(MENUITEM) ?? target);

      const moved = menuTarget(event.key, from, items.length);
      if (moved !== null) {
        event.preventDefault();
        // Nothing outside an open menu should also act on the key that moved focus inside it.
        event.stopPropagation();
        query = "";
        land(items[moved]);
        return;
      }

      const typed = typeaheadQuery(query, event.key, event.timeStamp - typedAt);
      if (typed === null) return;
      query = typed;
      typedAt = event.timeStamp;

      const found = typeaheadTarget(
        typed,
        items.map((item) => item.textContent ?? ""),
        from,
      );
      if (found === null) return;
      event.preventDefault();
      event.stopPropagation();
      land(items[found]);
    };

    // Re-run on every change to the menu's contents, not only on open: an item that arrives
    // while the menu is up needs its `tabindex`, and an item that leaves can take focus to
    // `<body>` with it — where no key reaches the menu at all and Escape is the only way out.
    const sync = () => {
      const active = document.activeElement;
      const items = itemsIn(node);
      rove(items, active);
      if (active !== null && active !== document.body && active !== node) return;
      // The picker's lists arrive a tick after it opens, so this is also where a menu that had
      // nothing to offer when it opened finally offers it.
      if (items[0]) land(items[0]);
      else if (active !== node) node.focus({ preventScroll: true });
    };

    sync();

    // Opening should land on the first item, the way a menu button does — but not yet. An
    // anchored menu renders one frame at `visibility: hidden` while it is measured against the
    // trigger, and `focus()` on a hidden element is a silent no-op: the call appears to work,
    // `document.activeElement` stays on the trigger, and every arrow key after it goes to the
    // page instead of to the menu, because the listener below is on the menu. So try, and if
    // focus did not take, try again next frame. Bounded, in case something else is holding it.
    let frame = 0;
    let tries = 0;
    const openFocus = () => {
      // Focus on something *within* the menu means someone else has placed it deliberately —
      // the autofocused rename field — and it is not ours to move. Focus on the panel itself is
      // not that: it is the fallback the panels put there before this hook existed, and an item
      // is better than it, because a menu that opens on its own container announces its name and
      // then leaves the reader to guess that there is anything inside.
      const active = document.activeElement;
      if (active !== node && node.contains(active)) return;
      const first = itemsIn(node)[0];
      if (!first) return;
      land(first);
      if (document.activeElement !== first && (tries += 1) < 10) {
        frame = requestAnimationFrame(openFocus);
      }
    };
    openFocus();

    const watcher = new MutationObserver(sync);
    watcher.observe(node, { childList: true, subtree: true });
    node.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      watcher.disconnect();
      node.removeEventListener("keydown", onKeyDown);
      // `<body>` counts, and is in fact the usual case: React runs a passive cleanup for a
      // deleted subtree *after* the nodes are gone, so by now focus has already fallen off the
      // item that had it and `node` is detached. Anything else holding focus was chosen by
      // someone, and taking it away would be the same rudeness this is here to undo.
      const landed = document.activeElement;
      const loose = landed === null || landed === document.body || node.contains(landed);
      if (returnFocus && loose) opener?.focus?.();
    };
  }, [open, menu, returnFocus]);
}

export function useAnchoredMenu(remeasure?: unknown, width = WIDTH) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;

      const wantLeft = rect.right - width;
      const left = Math.min(
        Math.max(MARGIN, wantLeft < MARGIN ? rect.left : wantLeft),
        Math.max(MARGIN, window.innerWidth - width - MARGIN),
      );

      const height = menu.current?.offsetHeight ?? 0;
      const below = window.innerHeight - rect.bottom;
      const fitsBelow = height + MARGIN <= below;
      const top = fitsBelow || below >= rect.top ? rect.bottom + 6 : rect.top - 6 - height;
      const maxTop = Math.max(MARGIN, window.innerHeight - height - MARGIN);
      const next = { left, top: Math.min(Math.max(MARGIN, top), maxTop) };

      setAt((prev) => (prev && prev.left === next.left && prev.top === next.top ? prev : next));
    };

    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, remeasure, width]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close(true);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  useMenuKeyboard(menu, open);

  const placed = open ? at : null;
  return { open, setOpen, close, root, trigger, menu, placed, style: placed ?? UNPLACED };
}
