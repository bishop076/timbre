"use client";

/**
 * The first thing a keyboard reaches on every page: one press to jump the sidebar, the nav and
 * the search box and land in the content. WCAG 2.4.1.
 *
 * It does not need anyone to have put an id on `<main>`. `href="#main-content"` is the fast path
 * when the id is there; when it is not, the click handler finds the `<main>` element itself and
 * focuses it. That fallback is deliberate — this component is mounted from a file that does not
 * own the shell, and a skip link that silently stops working the next time the shell is
 * rearranged is worse than none, because it looks present in an audit.
 */
export const MAIN_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_ID}`}
      onClick={(event) => {
        const main =
          document.getElementById(MAIN_ID) ?? document.querySelector<HTMLElement>("main");
        if (!main) return;
        event.preventDefault();
        // A <main> is not focusable by default, so give it a programmatic-only tabstop rather
        // than a permanent one — the reader lands there, Tab carries on into the content, and
        // the element never appears in the tab order on its own account.
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
      // Parked above the viewport rather than hidden with `sr-only`. `sr-only` and the
      // `focus:not-sr-only` that undoes it both set `position`, and which of the two wins depends
      // on the order Tailwind happens to emit them in — a coin flip that decides whether this is
      // visible at the moment it matters. Moving it is a single property and cannot be tied.
      className="slab fixed left-3 top-3 z-[200] -translate-y-24 rounded-[var(--r-md)] bg-[var(--surface-1)] px-4 py-2.5 text-[13px] font-bold text-[var(--fg)] shadow-[var(--drop-lg)] focus-visible:translate-y-0"
    >
      Skip to content
    </a>
  );
}
