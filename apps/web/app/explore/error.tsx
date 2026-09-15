"use client";

import { ErrorPanel } from "@/app/failure-panel";

/**
 * Explore is the one route that awaits four upstreams at once — charts, genre charts, rankings
 * and stations — so it is also the one most likely to be taken down by a single slow one. Its
 * own boundary keeps that failure off the rest of the app.
 */
export default function ExploreError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPanel where="Explore" title="The charts didn’t arrive." error={error} retry={retry}>
      Explore is built from several charts at once, and it only renders when they all answer.
      One of them didn’t. Everything already in your library is unaffected.
    </ErrorPanel>
  );
}
