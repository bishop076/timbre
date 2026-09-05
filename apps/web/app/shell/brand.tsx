/**
 * The logo, in one place so the rail and anything that wants it later cannot drift.
 *
 * The mark alone — no wordmark beside it. The name is already the tab, the installed app
 * and the heading of every page that needs one, so spelling it out again at the top of the
 * rail is a third copy that only costs the library panel below it a row of height.
 *
 * Deliberately not a link. Home is a nav button a centimetre below this row, and a second
 * way to reach it that looks nothing like the first is the same duplication that kept
 * Library out of `NAV` — see the note there.
 */

/**
 * The waveform, at its own aspect. Sized by height alone; the viewBox supplies the width,
 * which is why nothing here sets one — a square box would letterbox a mark that is 106×60.
 *
 * The viewBox *is* the ink's bounding box, deliberately. Each quadratic peaks at y=8 and
 * y=52 rather than at its control point, and half of the 16-unit stroke on either side puts
 * the drawn edges exactly on 0 and 60 — so `h-6` gives six units of visible mark rather than
 * six units of mostly padding. `apps/web/app/icon.svg` is generated from this same path.
 *
 * Stroked, not filled: this is one open curve, and a fill would close it into a blob.
 *
 * Labelling is the caller's, not this component's: the same mark is a named landmark in the
 * rail and pure decoration anywhere it sits beside the word "Timbre", and only the caller
 * knows which. Unlabelled and un-hidden is the wrong default for both, so it is not offered
 * — pass `aria-hidden` or a `role`/`aria-label` pair.
 */
export function TimbreMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 106 60" fill="none" {...props}>
      <path
        d="M8 30 Q23 -14 38 30 Q53 74 68 30 Q83 -14 98 30"
        stroke="currentColor"
        strokeWidth={16}
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center px-3 pt-1.5 pb-0.5">
      {/* The one place the name is not written out, so it is said here instead — a screen
          reader landing on the rail would otherwise meet an unlabelled graphic. */}
      <TimbreMark
        role="img"
        aria-label="Timbre"
        className="h-6 w-auto shrink-0 text-[var(--accent)]"
      />
    </div>
  );
}
