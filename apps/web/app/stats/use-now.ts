"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * The moment the page decided what "today" means, read once and then held still.
 *
 * "The last 7 days" cannot be worked out without the clock, and there are three wrong ways to
 * reach for it in a component. `Date.now()` in the render body is impure — two renders of the
 * same state can disagree, and the lint rule that says so is right. A `setState` in a mount
 * effect is a cascading render for a value that was available the whole time. And handing
 * `Date.now` straight to `useSyncExternalStore` is an infinite loop, because the snapshot is a
 * new number every time React asks.
 *
 * So it is read once per tab, cached, and served as a stable snapshot — zero on the server, where
 * there is no "today" worth agreeing on, which is also the value that keeps the page showing its
 * skeleton until hydration. A tab left open across midnight keeps yesterday's boundary until it
 * is reloaded; for a page of listening totals that is not worth a timer.
 */
let taken = 0;

const now = (): number => (taken ||= Date.now());

const onServer = () => 0;

export function useNow(): number {
  return useSyncExternalStore(subscribe, now, onServer);
}
