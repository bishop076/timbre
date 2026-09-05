"use client";

import { useCallback, useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

// The SoundCloud HTML5 Widget player, embedded unmodified. Mirrors `youtube-player.tsx`,
// including the parts that look paranoid: the widget *replaces* the iframe it is given, so
// the node is created imperatively rather than managed by React; a load timeout, because
// an ad blocker can stop the script arriving and leave the bar on a black box forever; and
// polling, since `PLAY_PROGRESS` only fires while playing.

interface SCWidget {
  bind(event: string, handler: (payload?: { currentPosition?: number }) => void): void;
  unbind(event: string): void;
  load(url: string, options: { callback?: () => void; auto_play?: boolean }): void;
  play(): void;
  pause(): void;
  setVolume(level: number): void;
  seekTo(milliseconds: number): void;
  getDuration(callback: (duration: number) => void): void;
  getPosition(callback: (position: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
}

interface SCNamespace {
  Widget: ((element: HTMLIFrameElement) => SCWidget) & {
    Events: {
      READY: string;
      PLAY: string;
      PAUSE: string;
      FINISH: string;
      ERROR: string;
      PLAY_PROGRESS: string;
    };
  };
}

declare global {
  interface Window {
    SC?: SCNamespace;
  }
}

const API_SRC = "https://w.soundcloud.com/player/api.js";

let apiPromise: Promise<SCNamespace> | null = null;

function loadApi(): Promise<SCNamespace> {
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<SCNamespace>((resolve, reject) => {
    if (window.SC?.Widget) {
      resolve(window.SC);
      return;
    }
    // No ready callback, unlike YouTube's API — it just defines window.SC, so the script's
    // own load event is the handshake.
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${API_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => {
      if (window.SC?.Widget) resolve(window.SC);
      else reject(new Error("SoundCloud widget API loaded without SC.Widget."));
    });
    script.addEventListener("error", () => reject(new Error("SoundCloud widget API blocked.")));
    if (!existing) {
      script.src = API_SRC;
      script.async = true;
      document.head.append(script);
    }
  });

  // A rejection is not memoised. The script being blocked once — a flaky network, an
  // extension toggled mid-session — must not read as blocked for as long as the tab lives.
  apiPromise = apiPromise.catch((cause: unknown) => {
    apiPromise = null;
    throw cause;
  });
  return apiPromise;
}

/**
 * How long a track gets to actually start before it is treated as refused.
 *
 * **SoundCloud can refuse a track without ever saying so.** Measured 2026-08-20 against
 * `soundcloud.com/stellalefty/boston` — a distributed release, `policy: MONETIZE`,
 * `monetization_model: AD_SUPPORTED`, `snipped: false` — the widget emits
 * `READY → PAUSE → PLAY → PAUSE → PAUSE` and sits at position 0 for ever. **No `ERROR`
 * event fires**, so the `ERROR` binding below never runs, `handleError` is never called, the
 * ladder never falls through, and the reader watches `0:00 / 2:50` with a play button that
 * does nothing.
 *
 * It is not this app: the identical iframe, widget and `play()` call reproduce it on a bare
 * page. And it is not a blanket block — a non-monetised upload driven the same way advanced
 * normally in the same browser a minute earlier. SoundCloud's own tracker carries the same
 * symptom against the Widget API ("not playing for some artists/tracks"), and their help
 * pages document a per-track **Enable app playback** permission that leaves a track playable
 * on soundcloud.com and through their embeds while refusing apps that use the API. Whichever
 * of those it is, it is the uploader's or distributor's setting and there is nothing to fix
 * on this side — except noticing.
 *
 * Nothing here can tell it apart from a slow start, so this is a timeout rather than a
 * detection. Seven seconds is long enough that a cold widget on a poor connection has
 * started, and short enough that the fall-through still feels like part of loading.
 *
 * **Deliberately `paused` and not merely "position is still zero".** A track in its first
 * moment of playback also reads zero, and a transport screenshot taken then looks exactly
 * like a stall — which is how a version of this check that ignored `paused` briefly got
 * written. `PLAY_PROGRESS` cancels the timer either way, but the narrower condition is the
 * one there is actual evidence for.
 */
const STALL_MS = 7000;

// The widget takes the track's permalink, not an id, in the initial `src`. Calling
// `load()` on a widget that already holds this track resets it and `PLAY` stops arriving —
// the track sits at 0:00 forever — so `load()` is reserved for a track *change*.
function widgetSrc(trackUrl: string): string {
  const params = new URLSearchParams({
    url: trackUrl,
    auto_play: "true",
    show_artwork: "true",
    visual: "false",
    // **Suppresses the "Hear more on SoundCloud" panel** that covers the widget — an overlay
    // reading *"Explore more music & audio like <track> on SoundCloud"* with a button, which
    // in a bar-sized player hides the transport entirely.
    //
    // `show_teaser` is **not** in SoundCloud's published parameter list — that documents only
    // `auto_play`, `color`, `buying`, `sharing`, `download`, `show_artwork`, `show_playcount`,
    // `show_user`, `start_track` and `single_active`. It is what SoundCloud's own Share →
    // Embed dialog emits, which is why every embed in the wild carries it.
    //
    // **Honest status: accepted, not proven.** Verified here that the widget loads and plays
    // normally with it set, and that the teaser element (`.sound__teaser`) is present but at
    // `opacity: 0` — with or without the parameter. It could not be made to appear in a
    // headless browser, including by seeking a 27-second track to its end and catching
    // `FINISH`, so *that it suppresses the panel* is reasoned from the parameter's name and
    // usage rather than measured. If the panel still appears, this line is not the fix and
    // nothing else here is either: the widget is cross-origin, so its DOM cannot be styled
    // from this side.
    show_teaser: "false",
  });
  return `https://w.soundcloud.com/player/?${params.toString()}`;
}

export function SoundCloudPlayer({
  trackUrl,
  artworkUrl,
  expanded = false,
  size = "w-full",
}: {
  trackUrl: string | null;
  /** The song's cover. Only drawn when {@link expanded} — see the layout note below. */
  artworkUrl?: string | null;
  /** Whether the panel fills the content area. The two states want different things, so
   * this is a real distinction rather than one layout stretched across both. */
  expanded?: boolean;
  /** Sizing only, for the same reason as {@link YouTubePlayer}'s. */
  size?: string;
}) {
  const {
    volume,
    muted,
    handleEnded,
    handleStateChange,
    handleProgress,
    handleError,
    registerToggle,
    registerSeek,
  } = usePlayerControls();

  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<SCWidget | null>(null);
  const readyRef = useRef(false);
  /** The track the widget currently holds, so it is never pointlessly reloaded. */
  const loadedUrl = useRef<string | null>(null);
  /** The pending stall check, cleared on unmount and replaced on every track change. */
  const stallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlers = useRef({ handleEnded, handleStateChange, handleProgress, handleError });
  useEffect(() => {
    handlers.current = { handleEnded, handleStateChange, handleProgress, handleError };
  }, [handleEnded, handleStateChange, handleProgress, handleError]);

  /**
   * Gives the widget {@link STALL_MS} to leave 0:00, and reports a refusal if it does not.
   *
   * **`worthRetrying: true`, which needed a fix in the ladder first.** `handleError` ends
   * with a SoundCloud rung that used to be guarded only by a convention — *"SoundCloud …
   * reports not-worth-retrying, so a failure exits above rather than looping back here."*
   * Reporting `true` against that walked straight back into this player and restarted the
   * track that had just refused, for ever. Reporting `false` instead avoided the loop and
   * was worse in a way the screenshot made obvious: a song listed on **SoundCloud, YouTube
   * Music, Deezer and Apple** gave up entirely because the one source that refused was the
   * one being tried.
   *
   * So `player-context.tsx` gained `soundcloudTried`, the same guard `progressiveTried` and
   * `previewTried` already carry, and this can now say what is true — *this upload* failed,
   * another copy may not. The ladder falls through to YouTube, then the sources Timbre plays
   * itself, then the catalogue's own clip.
   */
  const watchForStall = useCallback((widget: SCWidget) => {
    if (stallTimer.current) clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => {
      if (!readyRef.current || widgetRef.current !== widget) return;
      widget.getPosition((position) => {
        widget.isPaused((paused) => {
          // Still exactly where it started, and not running. A reader who paused it
          // themselves within seven seconds of the start looks the same from here, which is
          // the cost of there being no error to listen for.
          if (position > 0 || !paused) return;
          handlers.current.handleError(
            "SoundCloud wouldn't start this track. It plays on soundcloud.com but refuses to start here — pick another source from the badges to hear it.",
            true,
          );
        });
      });
    }, STALL_MS);
  }, []);


  const level = muted ? 0 : volume;
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
    if (readyRef.current) widgetRef.current?.setVolume(level);
  }, [level]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || widgetRef.current) return;

    if (!trackUrl) return;

    const host = document.createElement("iframe");
    host.width = "100%";
    host.height = "166";
    host.frameBorder = "no";
    host.scrolling = "no";
    // Both required: without `encrypted-media` the widget logs a permissions policy
    // violation and refuses to start.
    host.allow = "autoplay; encrypted-media";
    host.src = widgetSrc(trackUrl);
    loadedUrl.current = trackUrl;
    container.append(host);

    let cancelled = false;

    const blocked = setTimeout(() => {
      if (!cancelled && !readyRef.current) {
        handlers.current.handleError(
          "Couldn't load SoundCloud's player. An ad blocker or network filter may be blocking it.",
          true,
        );
      }
    }, 8000);

    loadApi()
      .then((SC) => {
        if (cancelled) return;
        const widget = SC.Widget(host);
        widgetRef.current = widget;

        widget.bind(SC.Widget.Events.READY, () => {
          clearTimeout(blocked);
          readyRef.current = true;
          widget.setVolume(levelRef.current);
          // The track is already in the iframe src; `play()` covers a browser that refused
          // the autoplay in the URL and is a no-op otherwise.
          widget.play();
          watchForStall(widget);
        });
        widget.bind(SC.Widget.Events.PLAY, () => handlers.current.handleStateChange("playing"));
        // Real progress is proof it started, and the only signal that beats the timer
        // honestly — `PLAY` alone is not, because a refused track emits it and then pauses.
        widget.bind(SC.Widget.Events.PLAY_PROGRESS, () => {
          if (stallTimer.current) {
            clearTimeout(stallTimer.current);
            stallTimer.current = null;
          }
        });
        widget.bind(SC.Widget.Events.PAUSE, () => handlers.current.handleStateChange("paused"));
        widget.bind(SC.Widget.Events.FINISH, () => handlers.current.handleEnded());
        // Errors arrive without a code, so a private track cannot be told from a geo-blocked
        // one. Not retryable — there is no second upload to fall through to.
        widget.bind(SC.Widget.Events.ERROR, () =>
          handlers.current.handleError("SoundCloud couldn't play this track.", true),
        );
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(blocked);
        handlers.current.handleError("Couldn't load SoundCloud's player.", true);
      });

    return () => {
      cancelled = true;
      clearTimeout(blocked);
      if (stallTimer.current) clearTimeout(stallTimer.current);
      stallTimer.current = null;
      widgetRef.current = null;
      readyRef.current = false;
      host.remove();
    };
    // `trackUrl` is deliberately not a dependency: it only seeds the iframe's initial src,
    // and re-running this would restart the handshake on every track change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only a track *change* reloads the widget — see `widgetSrc`.
  useEffect(() => {
    if (!trackUrl) return;
    if (loadedUrl.current === trackUrl) return;
    if (!readyRef.current || !widgetRef.current) return;

    const widget = widgetRef.current;
    loadedUrl.current = trackUrl;
    widget.load(trackUrl, {
      // `callback` is more reliable than load()'s own auto_play flag.
      callback: () => {
        widget.play();
        watchForStall(widget);
      },
    });
  }, [trackUrl, watchForStall]);

  useEffect(() => {
    const timer = setInterval(() => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) return;
      widget.getDuration((duration) => {
        if (duration > 0) {
          widget.getPosition((position) =>
            handlers.current.handleProgress(position / 1000, duration / 1000),
          );
        }
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    registerSeek((seconds) => {
      if (!widgetRef.current || !readyRef.current) return;
      widgetRef.current.seekTo(seconds * 1000);
    });
    return () => registerSeek(null);
  }, [registerSeek]);

  useEffect(() => {
    registerToggle(() => {
      const widget = widgetRef.current;
      if (!widget || !readyRef.current) return;
      widget.isPaused((paused) => (paused ? widget.play() : widget.pause()));
    });
    return () => registerToggle(null);
  }, [registerToggle]);

  return (
    /*
     * **Docked: the player, and nothing else. Expanded: the cover, with the player above it.**
     *
     * SoundCloud's widget does not grow — `host.height` is 166 whatever the container is — so
     * a single layout cannot serve both sizes. Docked, the box is barely taller than the
     * widget, and anything added beside it is clutter around the one thing being asked for.
     * Expanded, the widget is a strip across the top of a screen-sized area, and the rest was
     * black.
     *
     * Two attempts got this wrong before it got right, both worth naming. Letting the cover
     * *fill* the slack the way `mixcloud-player.tsx` does cropped a square sleeve into a band
     * across a wide theater view. Wrapping the whole thing in padding to tidy it narrowed the
     * widget, which is the one element that should never have changed.
     *
     * So: the widget keeps its full width and its 166px in both states, and the cover appears
     * only when there is real room for it. Nothing about the widget is hidden, cropped or
     * overlaid — the constraint the licence imposes, and the reason the cover sits below
     * rather than behind.
     */
    <div className={`flex flex-col overflow-hidden bg-black ${size}`}>
      {/* Untouched in both states: full width, its own 166px, exactly as it always was. */}
      <div
        ref={containerRef}
        className="h-[166px] w-full shrink-0 overflow-hidden"
        aria-label="SoundCloud player"
      />
      {expanded && artworkUrl && (
        // `object-contain`, so a sleeve is shown whole rather than cropped to the shape of
        // whatever space happens to be left.
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artworkUrl}
            alt=""
            aria-hidden
            className="max-h-full max-w-full rounded-[var(--r-md)] object-contain"
          />
        </div>
      )}
    </div>
  );
}
