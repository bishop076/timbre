/**
 * SoundCloud is the one embed whose widget is kept across a track change: `activeSource` never
 * passes through `null` between two SoundCloud tracks, so the component is not remounted and the
 * iframe is reused. That makes "what the widget is holding" and "what should be playing" two
 * different things for the ~0.5–2s of the widget's handshake, and the gap between them is where
 * a track change lands and is lost.
 *
 * Recording the new url was only half of it: READY then called `play()` on a widget still
 * holding the *previous* track, so the old song played on while the bar, artwork and lyrics
 * showed the new one — and its FINISH advanced the queue from the wrong position. Both READY
 * and a track change ask this the same question, so neither can answer it differently.
 */
export type WidgetStep = { do: "play" } | { do: "load"; url: string } | { do: "nothing" };

export function widgetStep(holding: string | null, wanted: string | null): WidgetStep {
  if (!wanted) return { do: "nothing" };
  return holding === wanted ? { do: "play" } : { do: "load", url: wanted };
}

/**
 * What to do with a url when the widget may never arrive at all.
 *
 * `widgetStep` above answers the handshake; this answers the question underneath it. Because the
 * iframe is kept across a track change, this component is the one player whose load effect does
 * not re-run per track — so the eight-second "something is blocking this" deadline is armed once
 * per *mount*, and the ladder's own rescue landing on a second SoundCloud copy reaches the same
 * mount with that deadline already spent. With no widget there is nothing for `apply` to drive
 * and nothing left to raise an error, so the track sat on "SoundCloud 0:00" for ever with the
 * play button showing Play: B-34's second half, in the player B-34 said had it right.
 *
 * `failed` is that mount's verdict. Held rather than assumed, because a widget that is merely
 * still handshaking must be waited for — reporting every url that arrives before READY would
 * walk the ladder off SoundCloud on every fast track change.
 */
export type WidgetHandoff = "apply" | "wait" | "report";

export function widgetHandoff(
  wanted: string | null,
  widget: { ready: boolean; failed: boolean },
): WidgetHandoff {
  if (!wanted) return "wait";
  if (widget.ready) return "apply";
  return widget.failed ? "report" : "wait";
}
