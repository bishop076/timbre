import Link from "next/link";

import { FailurePanel, PRIMARY } from "@/app/failure-panel";

/**
 * One segment above `[id]`, and deliberately. The `notFound()` for a missing release is raised in
 * `[id]/layout.tsx` — it has to be, or the 404 never reaches the status line — and a layout is
 * outside its own segment's not-found boundary. Left in `[id]/` this copy was skipped and the
 * root panel answered for it: a reader asking for a withdrawn release was told "there is nothing
 * at this address" rather than that Deezer had no such record.
 */
export const metadata = { title: "Album not found — Timbre" };

export default function AlbumNotFound() {
  return (
    <FailurePanel
      kind="missing"
      title="That album isn’t on Deezer."
      actions={
        <Link href="/" className={PRIMARY} style={{ background: "var(--accent)" }}>
          Go home
        </Link>
      }
    >
      Deezer answered, and had no release under this id. Releases do get withdrawn and
      re-catalogued, so a link that used to work can land here.
    </FailurePanel>
  );
}
