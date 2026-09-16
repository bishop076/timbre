import Link from "next/link";

import { FailurePanel, PRIMARY } from "@/app/failure-panel";

/** One segment above `[name]`, for the reason written out in `app/album/not-found.tsx`. */
export const metadata = { title: "Artist not found — Timbre" };

export default function ArtistNotFound() {
  return (
    <FailurePanel
      kind="missing"
      title="No artist by that name."
      actions={
        <Link href="/" className={PRIMARY} style={{ background: "var(--accent)" }}>
          Go home
        </Link>
      }
    >
      The name in the address came back empty once the slug was unpicked. Searching for it from
      the top of the app will find whatever spelling the sources actually use.
    </FailurePanel>
  );
}
