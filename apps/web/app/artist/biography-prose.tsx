"use client";

import { useEffect, useRef, useState } from "react";

// Four lines of `leading-7`, which is what the box was clamped to before it could be opened.
const COLLAPSED = "max-h-28 overflow-hidden";
const FADE = "[mask-image:linear-gradient(to_bottom,black_55%,transparent)]";

/**
 * Wikipedia's summary is prose, and the page used to print it as four clamped lines with no way
 * to read the rest — the one paragraph on an artist page a reader actually reads, cut mid-sentence.
 * It opens in place instead.
 *
 * Whether it *needs* opening is measured rather than guessed: a two-sentence summary fits inside
 * the collapsed height, and a "Read more" that reveals nothing is worse than no button at all.
 * The fade is tied to the same measurement, so a short summary is not dimmed for no reason.
 */
export function BiographyProse({ paragraphs }: { paragraphs: string[] }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const prose = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = prose.current;
    if (!element || open) return;

    const measure = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    measure();

    // Re-measure on a reflow: the column narrows when the sidebar opens, and a web font landing
    // after first paint changes the line count of a box that has already been measured.
    const sizes = new ResizeObserver(measure);
    sizes.observe(element);
    return () => sizes.disconnect();
  }, [open]);

  return (
    <>
      <div
        ref={prose}
        className={`max-w-prose text-[length:var(--text-body)] leading-7 tracking-[var(--track-body)] ${
          open ? "" : COLLAPSED
        } ${clipped && !open ? FADE : ""}`}
      >
        {paragraphs.map((paragraph, index) => (
          <p key={paragraph} className={index === 0 ? "text-[var(--fg)]" : "mt-3 text-[var(--fg-dim)]"}>
            {paragraph}
          </p>
        ))}
      </div>

      {clipped && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="press mt-2 text-[length:var(--text-meta)] font-bold text-[var(--fg-dim)] hover:text-[var(--fg)]"
        >
          {open ? "Read less" : "Read more"}
        </button>
      )}
    </>
  );
}
