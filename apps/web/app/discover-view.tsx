"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cover as coverSrc } from "./artwork-url";
import { Collage } from "./collage";
import { ShuffleIcon } from "./icons";
import { Shelf } from "./shelf";
import type { Discover } from "@/lib/discover";
import type { Radio } from "@/lib/radios";

/**
 * Explore — somewhere to browse, rather than a second home page.
 *
 * Home answers "what should I put on"; this answers "what is out there". The
 * two used to be the same screen with the search box in a different place,
 * which is why the field moved into the shell — see `top-bar.tsx`.
 *
 * **Laid out after Tidal's Explore**: a row of wide Featured cards, then titled
 * rows of pills — Genres, Moods & Activities, Decades — each with its own "View
 * all". The shape is what makes it read as a place to browse rather than a
 * stack of shelves.
 *
 * **Every card and pill leads to its own page**, and nothing on it is a chart.
 * The graphs lived here for a while and never sat right at any size: a browse
 * page is a set of doors, and an analytics card between two rows of pills reads
 * as a widget somebody left behind. They have a page of their own at
 * `/rankings`, reached from the Featured row like everything else.
 *
 * That is also the part that took two attempts. The first version put the chart's #1 album, artist and song in the
 * featured row and then listed the same chart underneath, so the page was one
 * set of songs shown three times — a decorated list, not somewhere to go. Now a
 * card opens a collection: a genre's chart, a Deezer playlist, or a mood
 * resolved to one, each with a cover, a queue and a Play button. See
 * `lib/collection.ts`.
 *
 * Everything is Deezer's, keyless. Timbre plays none of it directly: picking a
 * track resolves a copy it can drive, the same trade the artist pages make.
 */
export function DiscoverView({
  initial,
  radios,
  rankings,
}: {
  initial: Discover;
  radios: Radio[];
  /*
   * The charts, already rendered, rather than the data to render them from.
   *
   * This took six props before, which meant the page had to await every one of
   * them to call this component at all — and the charts are the slowest thing
   * on it and the lowest thing on it. As a slot they arrive behind their own
   * Suspense boundary and the browsing above paints without them.
   *
   * A `ReactNode` and not a component: this file is a client one, so it cannot
   * import the server component that does the fetching. Handing it in already
   * rendered is how the two meet.
   */
  rankings: ReactNode;
}) {
  return (
    <div className="@container mx-auto w-full max-w-6xl px-4 pb-16 pt-2 sm:px-7 sm:pb-20 sm:pt-4">
      <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">Explore</h1>

      {/*
        Browsing owns the first screenful.

        The charts sit under it, and "under" has to mean below the fold — a
        heading peeking over the bottom edge turns a section into a distraction
        from the one you are reading. A viewport-relative minimum does that at
        any window size, where a fixed margin would be right on one screen and
        wrong on every other.

        The subtraction is the chrome this page does not own — the sticky search
        bar above and the player bar below — and it was **too generous**, which
        is the opposite failure to the one it was written for. At 12rem the
        block finished about forty pixels short of the fold, so the next
        section's heading sat peeking over the bottom edge: half a line of text,
        which is exactly the leak this was meant to prevent. 9rem measures the
        chrome rather than over-allowing for it, so the block runs just past the
        fold and the next section starts cleanly below it.
      */}
      <div className="min-h-[calc(100dvh-9rem)]">
        <Featured data={initial} />

        {/*
        Three rows of pills, in Tidal's order: what it sounds like, what it is
        for, and when it is from.

        Genres come from Deezer, which publishes them. Moods and decades are
        written down, because no free source publishes "things a person might be
        doing" — but they are only *words*, sent to Deezer's playlist search when
        pressed. Nothing is assembled or stored for a pill nobody presses. See
        `lib/radios.ts`.
      */}
        <PillSection
          title="Genres"
          // `0` is Deezer's catalogue-wide chart. It is already the first card in
          // the Featured row above, and a pill called "Top songs" sitting among
          // the genres reads as a genre nobody has heard of.
          pills={initial.genres
            .filter((entry) => entry.id !== 0)
            .map((entry) => ({
              key: String(entry.id),
              label: entry.name,
              href: `/collection/genre/${entry.id}`,
            }))}
          initial={9}
          shuffleable
        />

        {/*
        One row of stations, not one row per genre.

        Grouping them under their genres produced five near-identical rows, with
        "Pop" and "Rock" appearing as *headings* directly under the same words as
        *pills* in the row above — so the page asked you to tell a genre apart
        from a genre-shaped section by its typography. Flattened, the two rows
        say two different things: the genre you want, or the mood you are in.
      */}
        <PillSection
          title="Stations"
          pills={interleave(radios).map((radio) => ({
            key: String(radio.id),
            label: radio.title,
            href: `/collection/radio/${radio.id}`,
          }))}
          initial={9}
          shuffleable
        />
      </div>

      {/*
        The charts, on the same page.

        They were a nav tab and a page of their own, which put four views behind
        a door most people never opened while this page — the one they do open —
        had room going spare. The rail keeps it to one view at a time, so the
        whole of it costs a single band of the page.
      */}
      {/*
        The same rule the rest of the site draws.

        This was briefly a gradient that faded out at both margins. It was the
        only divider in the app that did anything of the sort, so instead of
        reading as a section break it read as a mistake — a line that had failed
        to render properly. `--line` edge to edge is what separates rows in
        every list here, and a separator's job is to be recognised instantly,
        not to be interesting.

        The space around it is doing the real work either way; the rule only has
        to say the gap is deliberate.
      */}
      <div className="mt-10 border-t border-[var(--line)] pt-8 sm:mt-12 sm:pt-10">{rankings}</div>
    </div>
  );
}

/**
 * Featured — the wide cards the page opens with.
 *
 * Tidal's shape: a landscape frame with the artwork floating small and centred
 * on a colour field, then a coloured eyebrow, a title and a subtitle beneath.
 * The colour field is the artwork itself, blown up and blurred behind it, so
 * every card is tinted by what it holds without a palette having to be sampled
 * or stored anywhere.
 *
 * Where Tidal fills these by hand, Timbre has no editors — so each card is a
 * collection that already exists (Deezer's own charting playlists) or one the
 * chart can be gathered into. Nothing here invents an editorial claim; an
 * eyebrow reading "Editor's pick" would be a statement nobody made.
 *
 * The chart card has no published cover, because nobody draws a sleeve for "top
 * songs this week" — so it wears a scattered stack of its own covers. See
 * `collage.tsx`.
 */
function Featured({ data }: { data: Discover }) {
  const cards: {
    key: string;
    eyebrow: string;
    title: string;
    subtitle?: string;
    href: string;
    image: string | null;
    covers?: string[];
  }[] = [];

  if (data.tracks.length > 0) {
    cards.push({
      key: "chart",
      eyebrow: "Chart · this week",
      title: "Top songs this week",
      subtitle: `${data.tracks.length} songs · Deezer`,
      href: "/collection/genre/0",
      image: null,
      covers: data.tracks
        .map((track) => track.artworkUrl)
        .filter((url): url is string => Boolean(url))
        .slice(0, 5),
    });
  }

  for (const playlist of data.playlists.slice(0, 5)) {
    cards.push({
      key: `playlist-${playlist.id}`,
      eyebrow: "Playlist",
      title: playlist.title,
      subtitle: [playlist.trackCount ? `${playlist.trackCount} songs` : null, playlist.by]
        .filter(Boolean)
        .join(" · "),
      href: `/collection/playlist/${playlist.id}`,
      // The scatter when there is one, the published picture otherwise — a
      // collection should look like a collection.
      image: playlist.covers.length >= 3 ? null : playlist.coverUrl,
      covers: playlist.covers,
    });
  }

  /*
   * The charting albums, which were already being fetched and shown nowhere.
   *
   * They came out of the row of square tiles that used to sit under the charts,
   * and never went back in — so Explore was asking Deezer for twenty-five albums
   * an hour and dropping every one of them. They belong here: an album is a
   * collection with a cover, which is exactly what this row is for, and they are
   * what makes it long enough to be worth scrolling.
   */
  for (const album of data.albums.slice(0, 8)) {
    cards.push({
      key: `album-${album.id}`,
      eyebrow: album.kind === "single" ? "Single" : album.kind === "ep" ? "EP" : "Album",
      title: album.title,
      subtitle: album.artist,
      href: `/album/${album.id}`,
      image: album.coverUrl,
    });
  }

  /*
   * Deezer publishes no charting playlists for some genres, and none at all for
   * some countries. Rather than a short, half-empty row, the gap is filled with
   * the genres themselves — which are collections too, and are what somebody
   * who came here to browse was going to press next anyway.
   */
  if (cards.length < 4) {
    for (const genre of data.genres.filter((entry) => entry.id !== 0).slice(0, 5)) {
      cards.push({
        key: `genre-${genre.id}`,
        eyebrow: "Genre",
        title: `${genre.name} right now`,
        subtitle: "Deezer chart",
        href: `/collection/genre/${genre.id}`,
        image: genre.imageUrl,
      });
    }
  }

  if (cards.length === 0) return null;

  return (
    <Shelf title="Featured">
      {cards.map((card) => {
        // The blurred backdrop uses whatever the card actually has: a published
        // cover, or the first of its tiles.
        const backdrop = card.image ?? card.covers?.[0] ?? null;

        return (
          <Link key={card.key} href={card.href} className="group w-[15rem] shrink-0 sm:w-[20rem]">
            {/*
              4:3, which is Tidal's proportion — wide enough to read as a
              landscape card, tall enough that the artwork inside it can be
              large. At 16:10 the cover had to shrink to fit and the card became
              mostly background.
            */}
            <div className="press relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-2)]">
              {backdrop && (
                <>
                  {/*
                    The card's colour field, taken from its own artwork.

                    Scaled well past the frame so the blur has no edge to
                    feather against — a blur that can see the border pulls the
                    surface colour inwards and shows as a pale halo in the
                    corners. Saturated a little, because a heavy blur averages
                    a cover towards grey and Tidal's fields are anything but.
                  */}
                  {/*
                    Lazy and async, because this one is pure decoration.

                    It is the most expensive image on the page — drawn at twice
                    its box, heavily blurred and saturated — and it is
                    `aria-hidden`, so nothing is lost by letting it arrive late.
                    The featured row scrolls sideways, so most of these start
                    off-screen and were being fetched and composited anyway.
                  */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs */}
                  <img
                    /*
                      120px is generous for something drawn behind a blur-3xl at
                      twice its box: the blur destroys any detail a larger copy
                      would have carried, so a bigger one is bytes spent on
                      pixels that are mathematically discarded.
                    */
                    src={coverSrc(backdrop, 120) ?? undefined}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full scale-[2] object-cover opacity-70 blur-3xl saturate-150"
                  />
                  {/* A touch of depth towards the foot, so the artwork's own
                      shadow has something to fall on. */}
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-b from-white/5 to-black/25"
                  />
                </>
              )}

              {card.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- artwork comes from arbitrary source CDNs
                <img
                  // 76% of a card that tops out around 300px, so 500 device pixels.
                  src={coverSrc(card.image, 500) ?? undefined}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute left-1/2 top-1/2 aspect-square h-[76%] -translate-x-1/2 -translate-y-1/2 rounded-[4px] object-cover shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
                />
              ) : (
                /*
                  Positioned by this wrapper, not by a class on <Collage>.

                  Its root is `relative`, because the sleeves are absolute
                  against it — and Tailwind emits `.relative` after `.absolute`,
                  so passing `absolute inset-0` through lost the cascade. The box
                  fell back to `position: relative` with no height of its own,
                  every sleeve inside it was absolute, and the card collapsed to
                  nothing but its blurred backdrop. Same trap as the playlist
                  menu on a song tile.
                */
                <div className="absolute inset-0">
                  <Collage covers={card.covers ?? []} className="size-full" rounded="" />
                </div>
              )}
            </div>

            <p className="mt-2.5 truncate text-[10px] font-bold uppercase tracking-wider text-[var(--accent)]">
              {card.eyebrow}
            </p>
            {/* Two lines rather than one truncated. A featured card's title is
                the thing it is selling, and Tidal lets it wrap for the same
                reason — "Phoebe Bridgers, Nipsey Hussle, KATSEYE…" cut at the
                first name would be selling nothing. */}
            <p className="line-clamp-2 text-[13px] font-bold leading-snug group-hover:underline sm:text-[15px]">
              {card.title}
            </p>
            {card.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-[var(--fg-dim)] sm:text-[12px]">
                {card.subtitle}
              </p>
            )}
          </Link>
        );
      })}
    </Shelf>
  );
}

/**
 * A titled row of pills — Genres, Moods & Activities, Decades.
 *
 * One component for all three, because they differ only in their words. Copying
 * Tidal's arrangement once and handing it a list is what stops the three rows
 * drifting into three slightly different rows.
 *
 * "View all" opens the rest in place rather than leading somewhere. There is no
 * index page behind these, and a link to a page that does not exist is worse
 * than the eight pills it started with.
 */
function PillSection({
  title,
  pills,
  initial,
  shuffleable = false,
}: {
  title: string;
  pills: { key: string; label: string; href: string }[];
  initial: number;
  /** Adds the dice. Only worth it where the list is long enough to surprise. */
  shuffleable?: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  if (pills.length === 0) return null;

  const visible = expanded ? pills : pills.slice(0, initial);

  return (
    <section className="mb-6 sm:mb-8">
      <div className="mb-2.5 flex items-center justify-between gap-4 px-1 sm:mb-3.5">
        <h2 className="text-lg font-extrabold tracking-tight sm:text-xl">{title}</h2>

        <div className="flex shrink-0 items-center gap-2">
          {shuffleable && (
            <button
              type="button"
              onClick={() => {
                // Drawn in a handler, never during render — a random value taken
                // while rendering differs between React's two passes, and
                // between the server and the browser.
                const pick = pills[Math.floor(Math.random() * pills.length)];
                if (pick) router.push(pick.href);
              }}
              aria-label={`Open a random ${title.toLowerCase()} collection`}
              title="Surprise me"
              className="slab-sm press flex size-7 items-center justify-center rounded-[var(--r-full)] bg-[var(--surface-2)] text-[var(--fg-dim)] transition hover:text-[var(--fg)]"
            >
              <ShuffleIcon className="size-4" />
            </button>
          )}

          {pills.length > initial && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              className="press text-[12px] font-semibold text-[var(--fg-dim)] hover:text-[var(--fg)]"
            >
              {expanded ? "Show less" : "View all"}
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-1 sm:gap-2">
        {visible.map((pill) => (
          <Link
            key={pill.key}
            href={pill.href}
            className="slab-sm press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3 py-2 text-[12px] font-semibold text-[var(--fg-dim)] transition hover:text-[var(--fg)] sm:px-4 sm:py-2.5 sm:text-[13px]"
          >
            {pill.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * Stations, one genre at a time, round-robin.
 *
 * Deezer returns them grouped, so taking the first nine in order gives nine Pop
 * stations and a row that looks like a mistake. Dealing one from each genre in
 * turn means the visible handful spans the catalogue — pop, then rap, then rock
 * — which is the point of a browse row. Order within a genre is left as
 * published.
 */
function interleave(radios: Radio[]): Radio[] {
  const byGenre = new Map<string, Radio[]>();
  for (const radio of radios) {
    const existing = byGenre.get(radio.genre);
    if (existing) existing.push(radio);
    else byGenre.set(radio.genre, [radio]);
  }

  const queues = [...byGenre.values()];
  const out: Radio[] = [];
  // Capped: the full list runs past a hundred, and "View all" should open a
  // choice rather than a directory.
  for (let round = 0; out.length < 36; round += 1) {
    const before = out.length;
    for (const queue of queues) {
      const radio = queue[round];
      if (radio) out.push(radio);
    }
    if (out.length === before) break;
  }

  return out.slice(0, 36);
}
