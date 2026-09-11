"use client";

import { useEffect } from "react";

import { usePlayerControls } from "../player/player-context";

export function TabTitle() {
  const { current } = usePlayerControls();
  const title = current ? `Timbre · ${current.title}` : "Timbre";

  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };

    apply();

    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, [title]);

  return null;
}
