import type { ReactNode } from "react";

export const EYEBROW = "text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]";

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-7 sm:pb-20 sm:pt-6">
      {children}
    </div>
  );
}

export function PageHeader({
  art,
  eyebrow,
  title,
  children,
}: {
  art: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-4 sm:mb-7 sm:gap-5 @lg:flex-row @lg:items-end">
      {art}
      <div className="min-w-0 flex-1">
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:mt-1.5 sm:text-3xl @lg:text-4xl">
          {title}
        </h1>
        {children}
      </div>
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{children}</h2>;
}

export function SectionHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-4 px-1 sm:mb-3.5">
      <SectionTitle>{title}</SectionTitle>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function textBlock(base: string) {
  return function TextBlock({ className, children }: { className?: string; children: ReactNode }) {
    return <p className={className ? `${className} ${base}` : base}>{children}</p>;
  };
}

export const Notice = textBlock("text-sm leading-relaxed text-[var(--fg-dim)]");
export const Caption = textBlock("text-xs leading-relaxed text-[var(--fg-faint)]");
export const EmptyNotice = textBlock(
  "rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]",
);
