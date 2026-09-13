"use client";

import { EmptyNotice, Page } from "@/app/page-chrome";

export default function AlbumError({ retry }: { retry: () => void }) {
  return (
    <Page>
      <EmptyNotice>
        Deezer didn&apos;t answer for this album.{" "}
        <button type="button" onClick={retry} className="font-semibold text-[var(--fg)] underline">
          Try again
        </button>
      </EmptyNotice>
    </Page>
  );
}
