import Link from "next/link";

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
