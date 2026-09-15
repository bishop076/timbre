"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Whether a scroller has anything past its top or bottom edge.
 *
 * Paired with `.edge-fade` in globals.css, which masks only the side that has somewhere to go —
 * so content dissolves at an edge it continues past, and is left alone at one it does not. The
 * alternative is what the now-playing panel used to do: guillotine the content at a rounded
 * corner, which reads as a rendering fault rather than as "there is more".
 *
 * Lived in sidebar.tsx until the panel needed it too.
 */
export function useScrollEdges() {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const above = el.scrollTop > 1;
      const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
    };

    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.observe(el);
      for (const child of el.children) sizes.observe(child);
    };
    watch();
    const contents = new MutationObserver(watch);
    contents.observe(el, { childList: true });

    return () => {
      el.removeEventListener("scroll", measure);
      sizes.disconnect();
      contents.disconnect();
    };
  }, []);

  return [ref, edges] as const;
}
