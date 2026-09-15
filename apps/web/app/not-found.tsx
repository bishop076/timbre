import Link from "next/link";

import { FailurePanel, PRIMARY, SECONDARY } from "./failure-panel";

export const metadata = { title: "Not found — Timbre" };

/**
 * Also what `notFound()` reaches from any segment without a closer `not-found.tsx`, which is
 * why the copy stays about addresses rather than about music: it has to be true for a mistyped
 * URL and for a record that has gone.
 */
export default function NotFound() {
  return (
    <FailurePanel
      kind="missing"
      title="There is nothing at this address."
      actions={
        <>
          <Link href="/" className={PRIMARY} style={{ background: "var(--accent)" }}>
            Go home
          </Link>
          <Link href="/explore" className={SECONDARY}>
            Browse Explore
          </Link>
        </>
      }
    >
      The link may be old, or the record it pointed at is no longer served by whoever was
      serving it. Searching for the name usually finds it somewhere else.
    </FailurePanel>
  );
}
