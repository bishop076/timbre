"use client";

import { ErrorPanel } from "./failure-panel";

/**
 * The boundary for everything under the root layout that has not claimed one of its own —
 * home, search, library, liked, stats, profile, about, privacy. The shell, the player bar and
 * whatever is currently playing all survive it, because the layout is outside this boundary:
 * retrying re-renders the page alone and the music never stops.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <ErrorPanel
      where="A page"
      title="This page stopped working."
      error={error}
      retry={retry}
    >
      Something failed while rendering, and Timbre backed out of it rather than showing you
      half a page. Nothing you have saved was touched. If trying again does not help, the Logs
      tab under the settings gear on your profile says what each source answered.
    </ErrorPanel>
  );
}
