// Whether Spotify opens a song or catches it. Leading is right while Spotify is carrying
// playback and wrong the moment it is not, and which of those is true cannot be read up front:
// a free account looks exactly like a Premium one until the Web Playback SDK refuses. So the
// rule is written here, apart from the context that holds it, because the case that matters is
// the one nobody can sit down and reproduce — it needs a second Spotify account to see.

// A verdict is session-wide when it is a property of this browser or this account rather than of
// a track: a free account, a blocker killing spclient.spotify.com, a browser that cannot run the
// SDK at all. Those say something about every song that follows. The rest — `refused`,
// `playback_error`, `device-offline` — can genuinely differ track to track and say nothing.
export const SESSION_WIDE: ReadonlySet<string> = new Set([
  "not-connected",
  "sdk-failed",
  "blocked",
  "initialization_error",
  "authentication_error",
  "account_error",
  "stale-scopes",
]);

export interface LeadState {
  canLead: boolean;
  leading: boolean;
}

export const FRESH: LeadState = { canLead: true, leading: false };

// "downgrade" is Spotify's own 30-second embed with a line explaining why it is 30 seconds.
// "fall-through" hands the song back to the ladder, which still has YouTube to try.
export type AfterRefusal = "downgrade" | "fall-through";

export function leadFor(state: LeadState, hasTokens: boolean): boolean {
  return state.canLead && hasTokens;
}

// Downgrading in place is the right answer when Spotify was the *last* rung: nothing else could
// play the track, so a clip beats silence, and when somebody picked Spotify by hand they are owed
// the reason rather than a silent jump elsewhere. Leading inverts it — YouTube has not had its
// turn, and a clip the queue cannot advance past is worse than the fallback sitting there unused.
export function leadAfterRefusal(
  state: LeadState,
  reason: string,
): { state: LeadState; action: AfterRefusal } {
  if (!state.leading) return { state, action: "downgrade" };
  return {
    state: { canLead: state.canLead && !SESSION_WIDE.has(reason), leading: false },
    action: "fall-through",
  };
}

let state: LeadState = FRESH;

export function spotifyShouldLead(hasTokens: boolean): boolean {
  return leadFor(state, hasTokens);
}

export function markSpotifyLeading(): void {
  state = { ...state, leading: true };
}

export function clearSpotifyLeading(): void {
  state = { ...state, leading: false };
}

export function afterSpotifyRefusal(reason: string): AfterRefusal {
  const next = leadAfterRefusal(state, reason);
  state = next.state;
  return next.action;
}
