"use client";

import { EmptyNotice, Page } from "@/app/page-chrome";

export default function ArtistError({ retry }: { retry: () => void }) {
  return (
    <Page>
      <EmptyNotice>
        None of the sources answered for this artist.{" "}
        <button type="button" onClick={retry} className="font-semibold text-[var(--fg)] underline">
          Try again
        </button>
      </EmptyNotice>
    </Page>
  );
}
