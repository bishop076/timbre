"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useHydrated } from "../hydrated";
import { CheckIcon, PencilIcon } from "../icons";
import { PlaylistCover } from "../playlists/playlist-cover";
import { loadPlaylists, usePlaylists } from "../playlists/store";
import { SettingsPanel } from "./settings-panel";
import { isLightTheme, useTheme } from "../theme/theme-store";
import { Avatar, AVATAR_TONE, avatarHue } from "./avatar";
import { ImagePicker } from "./image-picker";
import { useDominantColor } from "./dominant-color";
import { useLocalImages } from "./local-images";
import { setDisplayName, useLocalProfile } from "./local-profile";

/**
 * The finished header gradient, for the boot script to replay.
 *
 * **This is the flash the reader actually sees on this page.** The wash is
 * built from a colour sampled out of the profile picture, and the picture is in
 * IndexedDB — so the whole chain is: hydrate, read storage, decode an image,
 * count its pixels, *then* colour the header. Several hundred milliseconds of a
 * flat dark band across the top of the page, on every single load, resolving
 * into colour once it is far too late to look intentional.
 *
 * Both grounds are recorded because the reader can be on either and the boot
 * script must not have to know how the ramp is built — the same reasoning as
 * `timbre:palette`. Recording the finished strings means there is exactly one
 * implementation of this gradient, here.
 */
const WASH_KEY = "timbre:profile-wash";

function recordWash(value: { dark: string; light: string } | null): void {
  try {
    if (value) window.localStorage.setItem(WASH_KEY, JSON.stringify(value));
    // Cleared rather than left: a banner or a removed picture means the header
    // is not a wash any more, and a stale record would paint one for a frame
    // before React took it away again.
    else window.localStorage.removeItem(WASH_KEY);
  } catch {
    // Storage unavailable. The header simply arrives a moment after the page.
  }
}

/**
 * The counts line, recorded one text node at a time.
 *
 * The playlists *are* readable synchronously — they live in `localStorage` — but
 * not until React is running, and this header renders before that.
 *
 * **Four values rather than one sentence, and the reason is the whole point of
 * this page.** Recording the line whole was tried first and looked wrong for
 * exactly the reason everything else here looked wrong: the stand-in was one
 * flat run of dim text, and React replaced it with the same words carrying bold
 * white digits. Nothing arrived late and it still visibly changed. A frame that
 * is *nearly* the settled frame is not an improvement on a frame that is
 * obviously not — it is the same defect, harder to see and harder to explain.
 *
 * Split per node, each figure sits in the element that styles it, so the first
 * paint and the settled paint are the same pixels.
 */
const COUNTS_KEY = "timbre:profile-counts";

interface Counts {
  playlists: string;
  playlistsLabel: string;
  songs: string;
  songsLabel: string;
}

function recordCounts(counts: Counts): void {
  try {
    window.localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
  } catch {
    // Storage unavailable. The line is simply blank until hydration.
  }
}

/**
 * A profile, shaped like Spotify's.
 *
 * Their header is a **flat wash of the profile picture's dominant colour**,
 * fading into the page, with the avatar and a very large name on it. That is
 * why their profiles stay calm whatever the picture looks like.
 *
 * Timbre's differs in one way: the wash is built at the *theme's* lightness
 * rather than always dark, so a pastel or white palette gets a pale version of
 * the same hue instead of a dark band across the top of a light page.
 *
 * Everything here is local. There is no account, so there is no email, no
 * follower count and nothing that could belong to a stranger — a profile is a
 * name you chose, two pictures, and what you have saved.
 */
export function ProfileView({
  /**
   * The name as the *server* knew it, from the cookie — see `page.tsx`.
   *
   * This is what removes the guest frame instead of hiding it. The server can
   * now render the right name, so there is no wrong one to replace and nothing
   * to hold back: the header simply draws, correct, in the first byte of HTML.
   *
   * Null for a browser that has never set a name, which is the one case where
   * the empty profile is the true answer.
   */
  serverName = null,
}: {
  serverName?: string | null;
}) {
  const profile = useLocalProfile();
  const local = useLocalImages();
  const { playlists, settled } = usePlaylists();
  const hydrated = useHydrated();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    loadPlaylists();
  }, []);

  /*
   * The cookie answers until storage can, and then it stops answering.
   *
   * The order matters and getting it wrong was a real bug: this read
   * `profile.name || serverName || "Profile"`, so **clearing your display name
   * did not clear it**. The client's value became null, the fallback chain
   * reached past it to the cookie the server had rendered from — a value frozen
   * at request time — and the old name came back and stayed until a reload.
   *
   * Once hydrated, the browser's own storage is the only authority, and "no
   * name" is one of the answers it is allowed to give.
   */
  const displayName = hydrated
    ? profile.name?.trim() || "Profile"
    : serverName?.trim() || "Profile";

  const playlistCount = playlists?.length ?? 0;
  const songCount = (playlists ?? []).reduce((total, list) => total + list.trackCount, 0);

  /*
   * Recorded once the figures are real, for the next load's first paint.
   *
   * Composed here rather than in the store because this is where the line is
   * written: the store owns the numbers, the header owns the sentence.
   */
  useEffect(() => {
    if (!settled) return;
    recordCounts({
      playlists: playlistCount.toLocaleString(),
      playlistsLabel: plural(playlistCount, "playlist"),
      songs: songCount.toLocaleString(),
      songsLabel: plural(songCount, "song"),
    });
  }, [settled, playlistCount, songCount]);

  /*
   * With no banner picture, the header takes its colour from the profile
   * picture.
   *
   * From the **avatar** and nothing else. It used to fall back to cover art,
   * which made the wash disagree with the face in front of it — the header
   * would settle on some album's blue while the monogram stayed orange. Album
   * art is the library's colour, not the person's. With no uploaded picture the
   * monogram *is* the picture, and its hue is already known without sampling.
   */
  const sampled = useDominantColor(local.avatar);

  /*
   * The wash waits until it can be right.
   *
   * Three things arrive at different times: the local id (localStorage, first
   * paint), the pictures (IndexedDB, async) and the colour sampled from the
   * avatar (an image decode after that). Painting on each meant the header
   * flashed through up to three colours on the way in — starting with the hue
   * derived from the placeholder id `"local"`, which is a yellow-green that
   * belongs to nobody.
   *
   * So nothing coloured is painted until the answer is settled: no id yet, no
   * pictures read yet, or a picture present whose colour is still being
   * sampled. Until then the header shows the **recorded** wash from the last
   * load — see `recordWash` — and only a browser that has never had one falls
   * back to the page's own ground.
   *
   * `sampled.settled` rather than "is there a colour yet". A picture with no
   * dominant hue at all — greyscale, or one that failed to decode — is a
   * finished answer, and treating it as an unfinished one meant the header
   * waited for a colour that was never coming and never painted a wash again.
   *
   * **Only the colour waits.** The name and the picture render immediately with
   * their ordinary fallbacks. Gating those was tried in four shapes —
   * recolouring, skeletons, hiding the header, hiding each piece — and every one
   * looked worse than the placeholder it was avoiding.
   */
  /*
   * `settled` **or a colour already in hand**, and the second half stops the
   * header flinching.
   *
   * The avatar's URL changes once per load by design — thumbnail first, then the
   * full copy out of IndexedDB — and a new source restarts the sampling, so
   * `settled` drops back to false halfway through every load. Gating on it alone
   * meant the header abandoned the colour it had just computed, fell back to the
   * recorded wash for a few hundred milliseconds, and came back: two transitions
   * of a 300ms `background-image` for a picture that never changed.
   *
   * A retained colour is a real answer. `useDominantColor` keeps the previous
   * one while it re-reads, and both readings are of the same photograph — it is
   * downscaled to 48px before counting pixels, so the thumbnail and the original
   * cannot meaningfully disagree.
   */
  const ready =
    Boolean(profile.id) && local.loaded && (sampled.settled || sampled.color !== null);
  const hue = sampled.color ? Math.round(sampled.color.h * 360) : avatarHue(profile.id || "local");
  const saturation = Math.min(0.58, Math.max(0.26, sampled.color?.s ?? AVATAR_TONE.saturation));

  /*
   * The wash follows the *theme's* ground, not a fixed dark.
   *
   * This is what made the first version wrong: the gradient was dark whatever
   * palette was chosen, so on pastel or white it dropped a heavy dark band
   * across the top of an otherwise light page. Same hue, opposite end of the
   * lightness scale, and the header belongs to the theme again.
   */
  const light = isLightTheme(useTheme());

  const stop = (lightness: number, satScale = 1) =>
    `hsl(${hue} ${Math.round(saturation * satScale * 100)}% ${lightness}%)`;

  /*
   * Solid at the top, dissolving into the page by the bottom. Three stops
   * rather than two: a straight linear fade reads as a visible diagonal band
   * across the middle, and the extra stop bends it into something that looks
   * like light falling off.
   */
  const washLight = `linear-gradient(to bottom, ${stop(84, 0.55)} 0%, ${stop(91, 0.4)} 45%, var(--surface-1) 100%)`;
  const washDark = `linear-gradient(to bottom, ${stop(34)} 0%, ${stop(22, 0.8)} 45%, var(--surface-1) 100%)`;
  const wash = light ? washLight : washDark;

  /*
   * Recorded for the next load, once — and only once it is the real answer.
   *
   * Both grounds go in, because the reader may switch theme between loads and
   * the boot script picks the one that matches the ground it has just stamped.
   * A banner clears the record instead: the header is a photograph then, not a
   * wash, and replaying a wash under it would paint a colour for one frame and
   * take it straight back off.
   *
   * Kept as two strings rather than one object so this depends on the values
   * and not on an object literal a render happened to build, which would make
   * it run on every render for no reason.
   */
  useEffect(() => {
    if (!ready) return;
    recordWash(local.banner ? null : { dark: washDark, light: washLight });
  }, [ready, local.banner, washDark, washLight]);

  /*
   * Whether the header text sits on something dark.
   *
   * A banner photo carries its own dark scrim, so white is right over one
   * regardless of theme. Otherwise it depends on the ground the wash was built
   * for. One flag rather than a colour per element, so the two cannot drift.
   */
  const onDark = Boolean(local.banner) || !light;

  function save(event: React.FormEvent) {
    event.preventDefault();
    setDisplayName(draft);
    setEditing(false);
  }

  return (
    <div className="@container w-full pb-16 sm:pb-20">
      {/* ---------------------------------------------------------------- */}
      {/* Header — Spotify's arrangement                                    */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="group/banner relative isolate flex min-h-[14rem] w-full items-end transition-[background-image] duration-300 sm:min-h-[19rem] @lg:min-h-[21rem]"
        /*
          The real wash once it is known, the recorded one until then.
          `--profile-wash` is set by the boot script in `layout.tsx` before the
          first paint, so a returning reader's header is already their colour in
          the first byte rather than a dark band that fills in later. Unset on a
          first visit, which correctly leaves the page's own ground.
        */
        style={
          local.banner
            ? undefined
            : { backgroundImage: ready ? wash : "var(--profile-wash, none)" }
        }
      >
        {local.banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, never a remote host */}
            <img
              src={local.banner}
              alt=""
              className="absolute inset-0 -z-10 size-full object-cover"
            />
            {/*
              Two gradients doing two different jobs, stacked.

              It used to be one — `from-[var(--surface-1)] via-black/45` — which
              conflated them. The dark scrim is there so white text stays
              legible over any photograph; the fade to the page colour is there
              so the banner has no hard bottom edge. On a dark ground both are
              dark and the seam is invisible, which is why one gradient was
              enough for a long time. On a light ground the second one fades to
              near-white, so a single ramp meant the picture dissolved into a
              broad pale band halfway up.

              Separated, the scrim is identical on both grounds — the text is
              white either way and needs the same help — while the blend to the
              page is short on light and long on dark, which is the only part
              that ever needed to differ.
            */}
            <div
              aria-hidden
              className="absolute inset-0 -z-10"
              style={{
                background: [
                  `linear-gradient(to top, var(--surface-1) 0%, transparent var(--banner-fade, 45%))`,
                  `linear-gradient(to top, rgb(0 0 0 / 0.45) 0%, rgb(0 0 0 / 0.1) 100%)`,
                ].join(", "),
              }}
            />
          </>
        )}

        {/*
          The page's own controls, in the corner the shell's top bar used to
          occupy. There is no bar on this route any more — see `top-bar.tsx` —
          so this is the only chrome up here and it does not collide with it.
        */}
        {/*
          One cluster, one behaviour. These are all controls *for the header*,
          so they appear together when it is being worked on and get out of the
          way otherwise — the picture is the point of this band, and a row of
          buttons parked on it permanently is chrome sitting on the content.

          Always visible on touch, where there is no hover to reveal them.
          `focus-within` keeps the whole group up while any of it holds focus,
          so tabbing to a control does not make it vanish under the caret.
        */}
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2 opacity-100 transition @lg:opacity-0 @lg:focus-within:opacity-100 @lg:group-hover/banner:opacity-100">
          <SettingsPanel />
          {/*
            A positioned box of its own, so the picker's error message hangs from
            the button rather than from the whole banner — without one it landed
            in the bottom-left corner of the header, nowhere near the control
            that had just rejected a file. It cannot go on the cluster itself:
            that is already `absolute`, and Tailwind emits `relative` after
            `absolute`, so the two together would silently un-position the row.
          */}
          <span className="relative flex items-center">
            <ImagePicker kind="banner" hasImage={Boolean(local.banner)} variant="button" />
          </span>
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pb-5 pt-12 sm:px-7 sm:pb-7 sm:pt-20">
          <div className="flex flex-col gap-3 sm:gap-5 @lg:flex-row @lg:items-end @lg:gap-6">
            {/*
              Big, and round. Spotify's profile avatar is far larger than a
              nameplate needs — it is the anchor the header is arranged around,
              and shrinking it makes a header look like a settings row.
            */}
            {/*
              `self-start` is load-bearing. A flex item stretches across the
              cross axis by default, and this column *is* the cross axis until
              `@lg` turns the header into a row — so the circle stretched into a
              full-width pill with the picture stranded at one end and the
              border drawn around the pill. `shrink-0` stops it shrinking and
              says nothing about growing.
            */}
            {/*
              A ring, not a `slab`. That class pairs a border with a hard offset
              drop shadow, which is the app's language and is built for
              rectangles — on a circle the offset reads as a dark crescent
              bleeding off one side, like a misregistered print. A ring hugs the
              curve, and a soft shadow lifts it off the banner without implying
              an edge that is not there.
            */}
            {/*
              Two boxes, and the outer one does not clip.

              The circle has to be `overflow-hidden` — it is what makes a square
              photograph round. But the picker's error message is positioned
              *below* the avatar, so while it lived inside the clipping box it
              was cropped away to nothing: choosing a file that was too large, or
              of the wrong type, produced no visible response whatsoever. The
              rejection was computed, reported and then hidden by a border
              radius.
            */}
            <div className="group relative shrink-0 self-start">
              <div className="overflow-hidden rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.4)] ring-2 ring-white/20">
                {/*
                  The monogram is not shown on the way to a photograph.

                  `Avatar` falls back to initials whenever it has no image, which
                  is right once that is the answer and wrong while it is still
                  being fetched: a reader with a picture saw a coloured monogram
                  appear, sit there, and be replaced — a whole extra state on
                  every reload, for a picture that was always going to arrive.
                  Before hydration it paints the cached thumbnail straight from
                  CSS instead, which commits to nothing it will have to undo.
                */}
                <Avatar
                  id={profile.id}
                  name={profile.name}
                  email={displayName}
                  image={local.avatar}
                  className="size-20 sm:size-32 @lg:size-48"
                  textClassName="text-3xl sm:text-5xl @lg:text-7xl"
                />
              </div>
              <ImagePicker kind="avatar" hasImage={Boolean(local.avatar)} variant="overlay" />
            </div>

            <div className="min-w-0 flex-1 @lg:pb-2">
              {!editing && (
                <p
                  className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${onDark ? "text-white/80" : "text-[var(--fg-dim)]"}`}
                >
                  Profile
                </p>
              )}

              {editing ? (
                <form onSubmit={save} className="flex max-w-sm flex-col gap-2">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={60}
                    autoFocus
                    placeholder="What should we call you?"
                    className="slab w-full rounded-[var(--r-md)] bg-[var(--surface-2)] px-3.5 py-2.5 text-xl font-extrabold outline-none placeholder:font-medium placeholder:text-[var(--fg-faint)]"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="slab-sm press inline-flex items-center gap-1.5 rounded-[var(--r-md)] px-3.5 py-2 text-[13px] font-bold text-[var(--accent-fg)]"
                      style={{ background: "var(--accent)" }}
                    >
                      <CheckIcon className="size-3.5" />
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="press rounded-[var(--r-md)] bg-[var(--surface-2)] px-3.5 py-2 text-[13px] font-semibold"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  {/*
                    Enormous, and clamped rather than truncated. A fixed size
                    either wastes the header on a short name or clips a long
                    one; `break-words` because a single long word has nowhere
                    to wrap and would overflow the column.
                  */}
                  <h1
                    className={`min-w-0 break-words font-extrabold leading-[1.05] tracking-tight ${onDark ? "text-white" : "text-[var(--fg)]"} ${
                      displayName.length > 22
                        ? "text-2xl sm:text-3xl @lg:text-4xl"
                        : displayName.length > 12
                          ? "text-3xl sm:text-4xl @lg:text-6xl"
                          : "text-4xl sm:text-5xl @lg:text-7xl"
                    }`}
                  >
                    {displayName}
                  </h1>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(profile.name ?? "");
                      setEditing(true);
                    }}
                    aria-label="Edit display name"
                    className={`press flex size-9 shrink-0 items-center justify-center rounded-[var(--r-full)] ${onDark ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-[var(--fg-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"}`}
                  >
                    <PencilIcon className="size-4" />
                  </button>
                </div>
              )}

              {/*
                Counts appear when they are counts — and the last known ones
                stand in until then.

                `playlists?.length ?? 0` rendered a confident "0 playlists · 0
                songs" on every load, for as long as it took storage to answer.
                Zero is a real and meaningful state here — it is what a new
                browser genuinely has — so showing it before the question has
                been asked is not a harmless placeholder; it is the wrong
                answer, stated in the same type as the right one.

                But gating it on `settled` alone left an **empty line** on every
                reload, which reads as the profile having nothing in it: a blank
                where two figures belong looks broken in a way that a stale
                figure does not. So the figures are recorded and replayed like
                everything else on this page — see `recordCounts` — one text node
                at a time, so the stand-in is the same pixels rather than merely
                the same words. At worst it is one load out of date, and this
                render corrects it in the same breath.

                The row itself is never conditional. Its slots are: they empty
                out and CSS fills them, so nothing appears, disappears or resizes
                between the first paint and the settled one, and the playlists
                below are never pushed down a frame after they were drawn.
              */}
              {!editing && (
                <div
                  className={`mt-3.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm ${onDark ? "text-white/75" : "text-[var(--fg-dim)]"}`}
                >
                  <Stat
                    value={settled ? playlistCount : null}
                    slot="playlists"
                    label="playlist"
                    onDark={onDark}
                  />
                  <Dot shown={settled} onDark={onDark} />
                  <Stat
                    value={settled ? songCount : null}
                    slot="songs"
                    label="song"
                    onDark={onDark}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Their playlists                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-7">
        <h2 className="mb-3 mt-6 text-lg font-extrabold tracking-tight sm:mb-4 sm:mt-8 sm:text-xl">
          Playlists
        </h2>

        {/*
          Before storage answers, both possible answers are in the markup and CSS
          picks the one this browser had last time.

          There are only two shapes this section can take — an empty-state box, or
          a grid of tiles — and which it will be is recorded: the boot script reads
          the same counts record the line above uses and sets `data-saved` to
          `none` or `some`. So the first paint shows the right one instead of
          showing *neither* and then inserting it, which pushed the page down a
          frame after it had been drawn.

          A genuine first visit has no record, neither rule matches, and nothing is
          reserved — correct, since there is nothing to predict.

          Not conditional on `settled` alone, because "not read yet" and "read, and
          empty" produce identical markup here and only the first should be
          predicted from a record that may be a load out of date.
        */}
        {!settled && (
          <>
            <p className="saved-none rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
              Nothing saved yet.
            </p>
            <ul
              aria-hidden
              className="saved-some grid grid-cols-3 gap-3 @md:grid-cols-3 @md:gap-4 @2xl:grid-cols-4 @4xl:grid-cols-5"
            >
              {Array.from({ length: 5 }, (_, index) => (
                <li key={index} className="p-2.5">
                  <div className="aspect-square w-full animate-pulse rounded-[var(--r-md)] bg-[var(--surface-2)]" />
                  <div className="mt-2.5 h-3.5 w-3/4 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
                  <div className="mt-1.5 h-3 w-2/5 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
                </li>
              ))}
            </ul>
          </>
        )}

        {settled && playlists?.length === 0 ? (
          <p className="rounded-[var(--r-lg)] bg-[var(--surface-2)] px-5 py-8 text-center text-sm leading-relaxed text-[var(--fg-dim)]">
            Nothing saved yet.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-3 @md:grid-cols-3 @md:gap-4 @2xl:grid-cols-4 @4xl:grid-cols-5">
            {playlists?.map((playlist) => (
              <li key={playlist.id}>
                <Link
                  href={`/playlist/${playlist.id}`}
                  className="block rounded-[var(--r-lg)] p-2.5 transition hover:bg-[var(--surface-2)]"
                >
                  <PlaylistCover
                    covers={playlist.covers}
                    className="slab aspect-square w-full rounded-[var(--r-md)]"
                  />
                  <span className="mt-2.5 block truncate text-sm font-semibold">
                    {playlist.name}
                  </span>
                  <span className="block text-xs text-[var(--fg-dim)]">
                    {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * "playlist" or "playlists". One rule, because the line is written twice — once
 * as markup and once as the string recorded for the next first paint — and a
 * profile that says "1 playlists" in one of them is worse than either.
 */
function plural(value: number, label: string): string {
  return `${label}${value === 1 ? "" : "s"}`;
}

/**
 * Points a `.replay` slot at the value the boot script recorded for it.
 *
 * The indirection is what keeps this to **one** CSS rule for the whole page:
 * a custom property can hold a reference to another one, so the element names
 * its own source and `.replay:empty::after` never has to know which.
 */
function replay(source: string): React.CSSProperties {
  return { "--replay": `var(${source}, "")` } as React.CSSProperties;
}

/**
 * One figure in the header's single stats line.
 *
 * `null` means "not counted yet", which is different from zero — see the note on
 * the row. In that state each of the two text nodes is left empty and CSS draws
 * the recorded one *in this element*, so the digits are already bold and the
 * label already dim before React has run. Same nodes, same styling, no change
 * when the real numbers land.
 */
function Stat({
  value,
  label,
  slot,
  onDark,
}: {
  value: number | null;
  label: string;
  /** Which pair of recorded values stands in — see `recordCounts`. */
  slot: "playlists" | "songs";
  onDark: boolean;
}) {
  return (
    <span>
      <span
        className={`replay font-bold tabular-nums ${onDark ? "text-white" : "text-[var(--fg)]"}`}
        style={replay(`--count-${slot}`)}
      >
        {value === null ? null : value.toLocaleString()}
      </span>{" "}
      <span className="replay" style={replay(`--label-${slot}`)}>
        {value === null ? null : plural(value, label)}
      </span>
    </span>
  );
}

/**
 * The separator between header facts.
 *
 * A slot like the figures either side of it, and for a reason worth stating: on a
 * browser with nothing recorded there are no figures to separate, and a lone
 * middle dot floating in an otherwise empty row is a worse first frame than an
 * empty row. The boot script only sets `--count-dot` when it has counts to put
 * around it.
 */
function Dot({ shown, onDark }: { shown: boolean; onDark: boolean }) {
  return (
    <span
      aria-hidden
      className={`replay ${onDark ? "text-white/40" : "text-[var(--fg-faint)]"}`}
      style={replay("--count-dot")}
    >
      {shown ? "·" : null}
    </span>
  );
}
