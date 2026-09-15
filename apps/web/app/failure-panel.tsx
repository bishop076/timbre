"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { log } from "./logs.ts";
import { Page } from "./page-chrome";

const ACTION =
  "press inline-flex items-center gap-2 rounded-[var(--r-full)] px-5 py-2.5 text-[13px] transition";

/** The filled violet button, matching the Play button on every detail page. */
export const PRIMARY = `${ACTION} slab-sm font-bold text-[var(--accent-fg)]`;

/** The quiet companion to it, matching Shuffle. */
export const SECONDARY = `${ACTION} bg-[var(--surface-2)] font-semibold text-[var(--fg-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--fg)]`;

function Glyph({ kind }: { kind: "broken" | "missing" }) {
  return (
    <span
      aria-hidden
      className="flex size-12 shrink-0 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg-faint)]"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-6"
      >
        {kind === "broken" ? (
          <>
            <path d="M10.9 3.9 2.5 18.4a1.3 1.3 0 0 0 1.1 2h16.8a1.3 1.3 0 0 0 1.1-2L13.1 3.9a1.3 1.3 0 0 0-2.2 0Z" />
            <path d="M12 9.5v4.2M12 17h.01" />
          </>
        ) : (
          <>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </>
        )}
      </svg>
    </span>
  );
}

/**
 * Every dead end in the app — a thrown render, a 404, a segment that gave up — lands on this
 * one shape: a glyph, a sentence that names what failed, and a way out that is a real control
 * rather than a suggestion to reload. Deliberately centred in a tall block: these replace a
 * whole page, and a notice pinned to the top of an otherwise empty screen reads as a bug.
 */
export function FailurePanel({
  kind = "broken",
  title,
  children,
  actions,
  note,
}: {
  kind?: "broken" | "missing";
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
}) {
  return (
    <Page>
      <section className="mx-auto flex min-h-[55dvh] max-w-md flex-col items-center justify-center py-10 text-center">
        <Glyph kind={kind} />
        <h1 className="mt-5 text-[length:var(--text-title)] font-extrabold tracking-tight">
          {title}
        </h1>
        <p className="mt-2.5 text-[length:var(--text-body)] leading-relaxed text-[var(--fg-dim)]">
          {children}
        </p>
        {actions && (
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">{actions}</div>
        )}
        {note && <p className="mt-7 font-mono text-[11px] text-[var(--fg-faint)]">{note}</p>}
      </section>
    </Page>
  );
}

/**
 * What an `error.tsx` renders. Besides the retry, it writes the failure into the log the reader
 * can actually open (Profile → settings → Logs), because a boundary that only paints a screen
 * leaves nothing behind once it has been retried — and a retry that works is exactly the case
 * where the reader later wants to know what happened the first time.
 *
 * `where` names the segment and the path names the record, so one line identifies both: which
 * page gave up, and which album or artist or station it gave up on.
 */
export function ErrorPanel({
  where,
  title,
  children,
  error,
  retry,
  actions,
}: {
  where: string;
  title: string;
  children: ReactNode;
  error: Error & { digest?: string };
  retry: () => void;
  actions?: ReactNode;
}) {
  const path = usePathname();

  useEffect(() => {
    // In production a server-side throw arrives redacted, with only the digest to go on. That
    // is still worth a line: the digest is what matches this entry to the server's own log.
    const detail = error.message.trim() || error.name || "no message";
    log("error", `${where} failed at ${path} — ${detail}${error.digest ? ` [${error.digest}]` : ""}`);
  }, [where, path, error]);

  return (
    <FailurePanel
      title={title}
      note={error.digest}
      actions={
        <>
          <button
            type="button"
            onClick={retry}
            className={PRIMARY}
            style={{ background: "var(--accent)" }}
          >
            Try again
          </button>
          {actions ?? (
            <Link href="/" className={SECONDARY}>
              Go home
            </Link>
          )}
        </>
      }
    >
      {children}
    </FailurePanel>
  );
}
