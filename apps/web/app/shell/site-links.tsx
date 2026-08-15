import Link from "next/link";

/**
 * About and Privacy — an obligation, not furniture: the services Timbre embeds require
 * that they are named and that a privacy policy is reachable, and a page nothing links
 * to does not discharge it.
 *
 * Rendered in two places on purpose. The rail is `lg:flex`, so the library page — which
 * is in the phone's bottom nav — carries the same links at its foot.
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
