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
