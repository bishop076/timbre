import Link from "next/link";

/**
 * About and Privacy, wherever there is room for them.
 *
 * These are obligations rather than furniture: the services Timbre embeds
 * require that they are named and that a privacy policy is reachable, so a page
 * nothing links to does not discharge it.
 *
 * Rendered in **two** places on purpose. The rail carries it on desktop, but
 * the rail is `lg:flex` and the phone's bottom nav has only four thumb targets
 * — spending one on a legal link would be the wrong trade. So the library page,
 * which *is* in that nav, carries the same links at its foot. Reachable on
 * every viewport, prominent on none, which is the correct weight for it.
 */
const LINKS = [
  { label: "About", href: "/about" },
  { label: "Privacy", href: "/privacy" },
];

export function SiteLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="About this site" className={`flex items-center gap-2.5 sm:gap-3 ${className ?? ""}`}>
      {LINKS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="text-[10px] font-semibold text-[var(--fg-faint)] transition hover:text-[var(--fg-dim)] sm:text-[11px]"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
