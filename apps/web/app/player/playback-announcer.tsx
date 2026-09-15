"use client";

import { useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

/**
 * What the player did, said out loud.
 *
 * Every transport control in the app is a button whose *label* stays put while its *meaning*
 * changes — Play becomes Pause, the track behind it becomes a different track — and a screen
 * reader is told none of that, because nothing in the DOM the reader is focused on has altered.
 * Space bars the track forward and the room goes quiet. This is the one place that says so.
 *
 * Polite, not assertive: a track change is news, but it is not worth cutting off whatever the
 * reader is in the middle of. `aria-atomic` so the whole sentence is re-read rather than the
 * diff between two track names, which comes out as word salad.
 *
 * The sentence is written straight into the node rather than held in state. A live region is an
 * external system — the browser watches it for mutations — so an effect is exactly the right
 * tool, and going through `useState` would re-render the whole player tree to change text nobody
 * can see. The region must already be in the document for the mutation to register, which is why
 * it renders empty from the first paint instead of appearing when there is something to say.
 */
function describe(title: string, artists: string[]): string {
  const who = artists.filter(Boolean).join(", ");
  return who ? `${title} by ${who}` : title;
}

export function PlaybackAnnouncer() {
  const { current, state } = usePlayerControls();
  const region = useRef<HTMLParagraphElement>(null);

  // What was true last time. Starting at `null` rather than at the current track is what stops a
  // reload from announcing the restored track as though it had just been started.
  const seen = useRef<{ id: string | null; state: string } | null>(null);

  useEffect(() => {
    const id = current?.id ?? null;
    const was = seen.current;
    seen.current = { id, state };

    const node = region.current;
    if (!was || !node) return;

    const say = (line: string) => {
      node.textContent = line;
    };

    if (id !== was.id) {
      say(current ? `Now playing: ${describe(current.title, current.artists)}` : "Playback stopped.");
      return;
    }
    if (state === was.state || !current) return;

    const who = describe(current.title, current.artists);
    if (state === "playing") say(`Playing: ${who}`);
    else if (state === "paused") say(`Paused: ${who}`);
    else if (state === "unplayable") say(`Can't play ${current.title}.`);
    else if (state === "resolving" || state === "loading") say(`Loading ${current.title}…`);
  }, [current, state]);

  return <p ref={region} role="status" aria-atomic="true" className="sr-only" />;
}
