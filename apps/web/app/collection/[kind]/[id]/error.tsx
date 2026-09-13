"use client";

import { EmptyNotice, Page } from "@/app/page-chrome";

export default function CollectionError({ retry }: { retry: () => void }) {
  return (
    <Page>
      <EmptyNotice>
        The source for this collection didn&apos;t answer.{" "}
        <button type="button" onClick={retry} className="font-semibold text-[var(--fg)] underline">
          Try again
        </button>
      </EmptyNotice>
    </Page>
  );
}
