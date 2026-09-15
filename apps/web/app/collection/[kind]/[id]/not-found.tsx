import Link from "next/link";

import { FailurePanel, PRIMARY } from "@/app/failure-panel";

export const metadata = { title: "Collection not found — Timbre" };

export default function CollectionNotFound() {
  return (
    <FailurePanel
      kind="missing"
      title="That collection has gone."
      actions={
        <Link href="/explore" className={PRIMARY} style={{ background: "var(--accent)" }}>
          Browse Explore
        </Link>
      }
    >
      Either the address names a kind of collection Timbre does not serve, or the playlist,
      station or chart behind it was taken down where it lived. Explore has the current ones.
    </FailurePanel>
  );
}
