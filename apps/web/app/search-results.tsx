"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { pastedCollectionOf } from "./pasted-collection";
import { SpotifySection } from "./spotify/spotify-section";

import { ArtistLink } from "./artist-link";
import { log } from "./logs.ts";
import { EYEBROW } from "./page-chrome";
import { usePlayerControls } from "./player/player-context";
import { RowSkeletons } from "./row-skeleton";
import { AlbumResults, ArtistResult, useArtistMatch } from "./search/search-facets";
import { rememberSearch } from "./search-history.ts";
import { setSearchQuery, useSearchQuery } from "./search-store";
import { askedFor, readSearchQuery } from "./search-url";
import { SongActions, SongRow } from "./song-row";
import { SourceBadges } from "./source-badges";
import { sourceStyle } from "./sources";
import type { Song, SongsResponse } from "./types";

/**
 * Where a track stops being a track. Mixcloud is entirely DJ sets, the Live Music Archive is
 * whole concerts, and SoundCloud carries plenty of full-album uploads — sorted in among three
 * minute songs they read as noise, so they get their own heading instead. Twelve minutes is
 * past the longest songs anyone searches for and short of the shortest set.
 */
const LONG_FORM_MS = 12 * 60 * 1000;

const SONGS_SHOWN = 12;
const MIXES_SHOWN = 5;

/** A white card with the ink edge, the shape everything else on the page is drawn in. */
const NOTICE =
  "slab-sm rounded-[var(--r-lg)] bg-[var(--surface-1)] px-4 py-3 text-[length:var(--text-meta)] leading-relaxed";

/** The small pill the shelves use for their counts and controls. */
const PILL =
  "slab-sm shrink-0 rounded-[var(--r-full)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[11px] font-bold";

const META = "text-[length:var(--text-meta)]";

function readableFailure(cause: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return "You're offline. Timbre searches other people's services, so it needs a connection — this will work again the moment you're back.";
  }
  if (cause instanceof TypeError) {
    return "Couldn't reach Timbre. The connection dropped, or something between here and it is blocking the request.";
  }
  return cause instanceof Error ? cause.message : "Something went wrong.";
}

/** "SoundCloud", "SoundCloud and Audius", "SoundCloud, Audius and Mixcloud". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function SearchResults() {
  const query = useSearchQuery();

  // Runs once. On a reload or a link opened cold the store is empty and the URL holds the
  // query; when arriving by typing, the store already agrees and this is a no-op.
  useEffect(() => {
    const fromUrl = readSearchQuery(window.location.search);
    if (fromUrl) setSearchQuery(fromUrl);
  }, []);

  // Keyed by the query that produced it. Results outlive the keystroke that invalidated them —
  // the rows stay put while the next search runs rather than blinking to skeletons — but the
  // header must not count a stale set as though it answered the query now in the box.
  const [results, setResults] = useState<{ key: string; data: SongsResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = askedFor(query);

    const timer = setTimeout(() => {
      controller.current?.abort();

      setError(null);
      const pasted = pastedCollectionOf(trimmed);
      if (!trimmed || (pasted && !pasted.withSong)) {
        setResults(null);
        setLoading(false);
        return;
      }

      const next = new AbortController();
      controller.current = next;
      setLoading(true);

      const link = /^https?:\/\//i.test(trimmed);
      const endpoint = link
        ? `/api/resolve?url=${encodeURIComponent(trimmed)}`
        : `/api/search?q=${encodeURIComponent(trimmed)}`;

      fetch(endpoint, { signal: next.signal })
        .then(async (response) => {
          if (response.status === 404 && link) {
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error ?? "That link isn't one Timbre can play.");
          }
          if (!response.ok) throw new Error(`Search failed (${response.status})`);
          const body = (await response.json()) as SongsResponse | { song: Song } | null;
          if (!body || typeof body !== "object") throw new Error("Search returned nothing readable.");
          return "song" in body ? { songs: [body.song], failures: [] } : body;
        })
        .then((data) => {
          setResults({ key: trimmed, data });
          setLoading(false);

          // Recorded here rather than where the box is typed in, because this is the point at
          // which a query stopped being keystrokes and became a search something answered. A
          // pasted link is left out: it is resolved rather than searched, and a 200-character
          // URL in a hint strip is a chip nobody can read.
          if (!link) rememberSearch(trimmed);

          const answered = (data.attempted ?? 1) - data.failures.length;
          log(
            data.failures.length > 0 ? "warn" : "info",
            `“${trimmed}” — ${answered}/${data.attempted ?? 1} sources answered, ${data.songs.length} results`,
          );
          for (const failure of data.failures) {
            // Not `: ${failure.message}` — `publicFailures()` in lib/api.ts strips the message
            // on purpose (it is upstream text, and can carry the query), so this printed the
            // literal word "undefined" after every refusal. The source is all the browser is
            // told; the why is on the server's own line, under `upstream_failed`.
            log("warn", `${failure.source} refused this search`);
          }
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === "AbortError") return;
          setError(readableFailure(cause));
          setLoading(false);
        });
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.current?.abort();
    };
  }, [query]);

  const trimmed = askedFor(query);
  const hasQuery = trimmed.length > 0;
  const pastedCollection = pastedCollectionOf(trimmed);
  const artistMatch = useArtistMatch(trimmed);

  const data = hasQuery ? results?.data : undefined;
  const songs = data?.songs ?? [];
  const failures = data?.failures ?? [];
  const attempted = data?.attempted ?? 0;
  const allSourcesDown = attempted > 0 && failures.length === attempted;
  const down = failures.map((failure) => sourceStyle(failure.source).label);

  // Three minutes and three hours are not the same kind of answer, and merging them into one
  // list is why a search for an artist used to come back looking like a radio schedule.
  const tracks = songs.filter((song) => (song.durationMs ?? 0) < LONG_FORM_MS);
  const mixes = songs.filter((song) => (song.durationMs ?? 0) >= LONG_FORM_MS);

  const settled = !loading && !error;
  const nothingFound = hasQuery && settled && !pastedCollection && songs.length === 0 && !allSourcesDown;

  // One sentence, announced. This whole subtree used to be the live region, which meant every
  // keystroke re-read every result row that had changed — a list of thirty songs, spoken, while
  // you were still typing the query. A live region should carry the *summary*; the results are
  // ordinary content you go and read.
  const status = !hasQuery
    ? ""
    : error
      ? "Search failed."
      : allSourcesDown
        ? "No music service could be reached."
        : loading && songs.length === 0
          ? `Searching for ${trimmed}…`
          : loading
            ? ""
            : songs.length === 0
              ? `No results for ${trimmed}.`
              : `${songs.length} result${songs.length === 1 ? "" : "s"} for ${trimmed}.` +
                (down.length > 0 ? ` ${nameList(down)} did not answer.` : "");

  return (
    <div aria-busy={loading || undefined}>
      <p role="status" aria-atomic="true" className="sr-only">
        {status}
      </p>

      {hasQuery ? (
        <ResultsHeader
          query={trimmed}
          loading={loading}
          total={songs.length}
          attempted={attempted}
          down={down}
        />
      ) : (
        <h1 className="sr-only">Search</h1>
      )}

      {error && <p className={`${NOTICE} text-[var(--danger)]`}>{error}</p>}

      {allSourcesDown && (
        <div role="alert" className={NOTICE}>
          <p className="font-bold text-[var(--danger)]">Couldn&rsquo;t reach any music service.</p>
          <p className="mt-1 text-[var(--fg-dim)]">
            All {attempted} of them are down or unreachable from here. This is not your search —
            it would find the same music the moment one of them answers. Try again in a moment.
          </p>
        </div>
      )}

      {!hasQuery && (
        <div className={`rise py-10 text-center ${META} text-[var(--fg-dim)]`}>
          <p>
            Type above to search, or press <kbd className="font-mono">/</kbd> from anywhere.
          </p>
          <p className="mx-auto mt-2.5 max-w-md text-[var(--fg-faint)]">
            One box, every free source Timbre can reach — songs, DJ sets, artists and albums come
            back together.
          </p>
          <p className="mx-auto mt-2 max-w-md text-[var(--fg-faint)]">
            Paste a <span className="text-[var(--fg-dim)]">SoundCloud</span> or{" "}
            <span className="text-[var(--fg-dim)]">Spotify</span> link and it plays here. A{" "}
            <span className="text-[var(--fg-dim)]">Spotify</span> album or playlist, or a{" "}
            <span className="text-[var(--fg-dim)]">YouTube</span> playlist, opens the whole list.
          </p>
        </div>
      )}

      {pastedCollection && (
        <Link
          href={pastedCollection.href}
          className="slab-sm press mb-4 flex items-center justify-between gap-4 rounded-[var(--r-lg)] bg-[var(--surface-1)] px-4 py-3 transition hover:bg-[var(--surface-2)]"
        >
          <span>
            <span className={`block ${EYEBROW}`}>
              {pastedCollection.service} {pastedCollection.noun}
            </span>
            <span className="mt-0.5 block text-[length:var(--text-body)] font-bold">
              Open this {pastedCollection.noun} in Timbre
            </span>
          </span>
          <span aria-hidden className="text-lg text-[var(--fg-dim)]">
            &rarr;
          </span>
        </Link>
      )}

      {hasQuery && loading && songs.length === 0 && <RowSkeletons />}

      {nothingFound && (
        <div className={`${NOTICE} text-center`}>
          {/* Scoped on purpose. "Nothing found" is a lie when the Spotify section below has
              found five things — it searches a different catalogue through a different endpoint
              and answers after this does. This sentence is about the sources counted above it. */}
          <p className="text-[var(--fg-dim)]">
            Nothing for &ldquo;{trimmed}&rdquo; from the sources above. Check the spelling, or try
            the artist&rsquo;s name on its own.
          </p>
          {down.length > 0 && (
            <p className="mt-1.5 text-[var(--warn)]">
              {nameList(down)} didn&rsquo;t answer either, so this is not the whole picture — the
              same search may find more in a moment.
            </p>
          )}
        </div>
      )}

      {hasQuery && songs.length > 0 && (
        <div className={`rise transition-opacity duration-200 ${loading ? "opacity-60" : ""}`}>
          {artistMatch && (
            <Group title="Artist">
              <ArtistResult artist={artistMatch.artist} />
            </Group>
          )}

          {tracks.length > 0 && <SongGroup key={`songs:${trimmed}`} title="Songs" songs={tracks} limit={SONGS_SHOWN} />}

          {mixes.length > 0 && (
            <SongGroup key={`mixes:${trimmed}`} title="Mixes & sets" songs={mixes} limit={MIXES_SHOWN} />
          )}

          {artistMatch && artistMatch.albums.length > 0 && (
            <Group title="Albums" count={artistMatch.albums.length}>
              <AlbumResults albums={artistMatch.albums} />
            </Group>
          )}
        </div>
      )}

      {/* Held back until the sources above have answered. Measured on a cold
          /search?q=nils%20frahm at 1536x690: this section painted at y=640 — the bottom of the
          window — 650ms before the results did, and the results then pushed it 1199px down the
          page. That single move was the whole page's CLS, 0.035 of it. Spotify searches a
          different catalogue through a different endpoint and usually answers *first*; the
          "nothing found" copy above already tells the reader it answers last, and now it does. */}
      {!loading && (
        <SpotifySection
          query={trimmed}
          render={(found) => (
            <ResultList songs={found} className="divide-y divide-[var(--line)]" />
          )}
        />
      )}
    </div>
  );
}

function ResultsHeader({
  query,
  loading,
  total,
  attempted,
  down,
}: {
  query: string;
  loading: boolean;
  total: number;
  attempted: number;
  down: string[];
}) {
  const answered = attempted - down.length;
  const results = `${total} result${total === 1 ? "" : "s"}`;

  // `answered === 0` gets its own branch because the arithmetic version of it read "0 results ·
  // all 6 sources answered" — the header congratulating six services for answering while the
  // alert under it said none of them could be reached.
  const coverage =
    attempted < 2
      ? results
      : answered === 0
        ? `${results} · no source answered`
        : down.length > 0
          ? `${results} · ${answered} of ${attempted} sources answered`
          : `${results} · all ${attempted} sources answered`;

  // The query already sits in the bar directly above this, so it is a heading and not a banner:
  // one line, with the count on the same baseline. The version that gave it an eyebrow and a
  // line of its own cost eighty-five pixels of a six-hundred-and-ninety pixel screen to repeat
  // a word the user can still see.
  return (
    <header className="mb-2.5 px-2 sm:mb-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h1 className="min-w-0 max-w-full truncate text-[length:var(--text-title)] font-extrabold tracking-[var(--track-title)]">
          {query}
        </h1>
        <p className={`${META} text-[var(--fg-dim)]`}>{loading ? "Searching…" : coverage}</p>
      </div>

      {/* A source being down is not a "no results" and it is not an emergency either. It is one
          quiet line the colour of a warning, naming who is missing, next to the count of who
          answered — no box, no border, nothing to dismiss. */}
      {!loading && down.length > 0 && answered > 0 && (
        <p className={`mt-1 flex items-center gap-1.5 ${META} text-[var(--warn)]`}>
          <span aria-hidden className="size-1.5 shrink-0 rounded-[var(--r-full)] bg-current" />
          <span className="min-w-0 truncate">
            {nameList(down)} didn&rsquo;t answer — everything else is here.
          </span>
        </p>
      )}
    </header>
  );
}

function Group({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-0 sm:mt-5">
      <div className="mb-1.5 flex items-center justify-between gap-4 px-2">
        <h2 className="flex min-w-0 items-center gap-2 text-[length:var(--text-section)] font-extrabold tracking-[var(--track-title)]">
          <span className="truncate">{title}</span>
          {/* The space before the pill is inside the heading on purpose: without it the
              accessible name comes out as "Songs64", because a gap is not a word boundary. */}
          {count !== undefined && (
            <>
              {" "}
              <span className={`${PILL} text-[var(--fg-dim)]`}>{count}</span>
            </>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Long lists arrive folded. Eighty-five results is a truthful answer and an unreadable page, and
 * the screen this is designed for shows about six rows at a time; the count next to the heading
 * says how many there are without making you scroll past them to find the next heading.
 */
function SongGroup({ title, songs, limit }: { title: string; songs: Song[]; limit: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? songs : songs.slice(0, limit);

  return (
    <Group
      title={title}
      count={songs.length}
      action={
        songs.length > limit && (
          <button
            type="button"
            onClick={() => setAll(!all)}
            className={`${PILL} press py-1 text-[var(--fg-dim)] transition hover:bg-[var(--surface-3)] hover:text-[var(--fg)]`}
          >
            {all ? "Show fewer" : `Show all ${songs.length}`}
          </button>
        )
      }
    >
      <ResultList songs={shown} queue={songs} className="divide-y divide-[var(--line)]" />
    </Group>
  );
}

function ResultList({
  songs,
  queue = songs,
  className,
}: {
  songs: Song[];
  queue?: Song[];
  className: string;
}) {
  const { play, current, state } = usePlayerControls();

  return (
    <ul className={className}>
      {songs.map((song) => (
        <SongRow
          key={song.id}
          song={song}
          // Playing a result carries the rest of its group along as the queue, so a search is
          // something you can start and leave running rather than one song and silence.
          onPlay={() => play(song, queue)}
          isCurrent={current?.id === song.id}
          isPlaying={state === "playing"}
          size="md"
          subtitle={
            <>
              <ArtistLink artists={song.artists} />
              {/* No opacity here. --fg-dim is already the muted tone and already clears AA;
                  fading it further measured 2.59:1 on the light page, where dimming moves text
                  toward the background rather than away from it. */}
              {song.album ? <span> · {song.album}</span> : null}
            </>
          }
          trailing={
            <>
              <SourceBadges song={song} className="hidden @xl:flex" />
              <SongActions song={song} durationClassName="pr-1" />
            </>
          }
        />
      ))}
    </ul>
  );
}
