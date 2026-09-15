/**
 * Every distinct way Spotify says no, and the one sentence each of them earns.
 *
 * These used to collapse into "Spotify answered 403" or a bare "preview" with no reason, which
 * reads as Timbre being broken when three of the four are Spotify policy working exactly as
 * documented. A reader can act on "your account is free" and on "not licensed in your country";
 * they can do nothing at all with a status code.
 */

export type SpotifyRefusal =
  | "no-account"
  | "premium-required"
  | "region-restricted"
  | "signed-out"
  | "app-full"
  | "rate-limited"
  | "unreachable"
  | "refused";

/** Headline first, then what to do about it — the panels render them as two lines. */
export const SPOTIFY_REFUSAL: Record<SpotifyRefusal, { title: string; detail: string }> = {
  "no-account": {
    title: "No Spotify account is connected",
    detail:
      "Spotify only serves a 30-second preview to a browser it does not recognise. That is their rule, not a fault here — connect an account in Profile → Settings → Sources to hear whole tracks.",
  },
  "premium-required": {
    title: "Full-length playback needs Premium",
    detail:
      "Spotify's Web Playback SDK refuses free accounts outright. Your account is connected and search works; playback stays at Spotify's 30-second preview until the account is Premium.",
  },
  "region-restricted": {
    title: "Not licensed in your country",
    detail:
      "Spotify has this track in its catalogue but will not play it to your account's market. Nothing here can override that; another copy of the song may still play from a different source.",
  },
  "signed-out": {
    title: "Spotify signed this browser out",
    detail:
      "The saved connection expired or was revoked — most often by changing your Spotify password, or by removing Timbre under Apps in your Spotify account. Connect again to restore it.",
  },
  "app-full": {
    title: "This Spotify app has not been granted your account",
    detail:
      "A Spotify app in development mode only serves listeners added to it by hand, by whoever registered it. Yours is not on that list.",
  },
  "rate-limited": {
    title: "Spotify is rate-limiting this app",
    detail: "Too many requests went out in too short a window. It answers again shortly.",
  },
  unreachable: {
    title: "Could not reach Spotify",
    detail:
      "The request never arrived. A dropped connection, a VPN, or a content blocker holding spotify.com are the usual three.",
  },
  refused: {
    title: "Spotify refused this request",
    detail: "It gave no reason Timbre can translate into anything more useful than that.",
  },
};

/**
 * The same status means different things at the two endpoints Timbre calls, so the caller says
 * which one it was. 403 from /v1/search is the development-mode allowlist; 403 from the player is
 * almost always Premium. 404 from the player is a track the market will not serve.
 */
export function refusalFor(status: number, from: "search" | "playback"): SpotifyRefusal {
  if (status === 401) return "signed-out";
  if (status === 429) return "rate-limited";
  if (status === 403) return from === "playback" ? "premium-required" : "app-full";
  if (status === 404 && from === "playback") return "region-restricted";
  return "refused";
}

/** One line, for the places too small to carry both. */
export function refusalLine(refusal: SpotifyRefusal): string {
  const { title, detail } = SPOTIFY_REFUSAL[refusal];
  return `${title}. ${detail}`;
}
