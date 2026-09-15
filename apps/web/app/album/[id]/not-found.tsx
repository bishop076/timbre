import Link from "next/link";

import { FailurePanel, PRIMARY } from "@/app/failure-panel";

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
