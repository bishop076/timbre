"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CheckIcon, PencilIcon } from "../icons";
import { PlaylistCover } from "../playlists/playlist-cover";
import { loadPlaylists, usePlaylists } from "../playlists/store";
import { ThemePicker } from "../theme/theme-picker";
import { isLightTheme, useTheme } from "../theme/theme-store";
import { Avatar, AVATAR_TONE, avatarHue } from "./avatar";
import { ImagePicker } from "./image-picker";
import { useDominantColor } from "./dominant-color";
import { useLocalImages } from "./local-images";
import { setDisplayName, useLocalProfile } from "./local-profile";

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
export function ProfileView() {
  const profile = useLocalProfile();
  const local = useLocalImages();
  const { playlists, settled } = usePlaylists();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    loadPlaylists();
  }, []);

  const displayName = profile.name?.trim() || "Profile";

  const songCount = (playlists ?? []).reduce((total, list) => total + list.trackCount, 0);

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
   * sampled. Until then the header is simply the page's own ground, which is
   * already behind it — one surface, not a coloured layer over another.
   */
  const awaitingSample = Boolean(local.avatar) && !sampled;
  const ready = Boolean(profile.id) && local.loaded && !awaitingSample;
  const hue = sampled ? Math.round(sampled.h * 360) : avatarHue(profile.id || "local");
  const saturation = Math.min(0.58, Math.max(0.26, sampled?.s ?? AVATAR_TONE.saturation));

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
  const wash = light
    ? `linear-gradient(to bottom, ${stop(84, 0.55)} 0%, ${stop(91, 0.4)} 45%, var(--surface-1) 100%)`
    : `linear-gradient(to bottom, ${stop(34)} 0%, ${stop(22, 0.8)} 45%, var(--surface-1) 100%)`;

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
    <div className="@container w-full pb-10">
      {/* ---------------------------------------------------------------- */}
      {/* Header — Spotify's arrangement                                    */}
      {/* ---------------------------------------------------------------- */}
      <div
        className="group/banner relative isolate flex min-h-[14rem] w-full items-end transition-[background-image] duration-300 sm:min-h-[19rem] @lg:min-h-[21rem]"
        // Only once the colour is the real one — see `ready` above.
        style={local.banner || !ready ? undefined : { backgroundImage: wash }}
      >
        {local.banner && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL, never a remote host */}
            <img
              src={local.banner}
              alt=""
              className="absolute inset-0 -z-10 size-full object-cover"
            />
            <div className="absolute inset-0 -z-10 bg-gradient-to-t from-[var(--surface-1)] via-black/45 to-black/10" />
          </>
        )}

        {/* Always visible on touch, where there is no hover to reveal them. */}
        <div className="absolute right-4 top-4 z-20 opacity-100 transition @lg:opacity-0 @lg:focus-within:opacity-100 @lg:group-hover/banner:opacity-100">
          <ImagePicker
            kind="banner"
            hasImage={Boolean(local.banner)}
            variant="button"
          />
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
            <div className="group relative shrink-0 self-start overflow-hidden rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.4)] ring-2 ring-white/20">
              <Avatar
                id={profile.id}
                name={profile.name}
                email={displayName}
                image={local.avatar}
                className="size-20 sm:size-32 @lg:size-48"
                textClassName="text-3xl sm:text-5xl @lg:text-7xl"
              />
              <ImagePicker
                kind="avatar"
                hasImage={Boolean(local.avatar)}
                variant="overlay"
              />
            </div>

            <div className="min-w-0 flex-1 @lg:pb-2">
              {!editing && (
                <p className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${onDark ? "text-white/80" : "text-[var(--fg-dim)]"}`}>
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

              {!editing && (
                <div className={`mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm ${onDark ? "text-white/75" : "text-[var(--fg-dim)]"}`}>
                  <Stat value={playlists?.length ?? 0} label="playlist" onDark={onDark} />
                  <Dot onDark={onDark} />
                  <Stat value={songCount} label="song" onDark={onDark} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Appearance                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="@container mx-auto w-full max-w-6xl px-5 pt-8 sm:px-7">
        <ThemePicker />
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Their playlists                                                   */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto w-full max-w-6xl px-4 sm:px-7">
        <h2 className="mb-3 mt-6 text-lg font-extrabold tracking-tight sm:mb-4 sm:mt-8 sm:text-xl">Playlists</h2>

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

/** One figure in the header's single stats line. */
function Stat({ value, label, onDark }: { value: number; label: string; onDark: boolean }) {
  return (
    <span>
      <span
        className={`font-bold tabular-nums ${onDark ? "text-white" : "text-[var(--fg)]"}`}
      >
        {value.toLocaleString()}
      </span>{" "}
      {label}
      {value === 1 ? "" : "s"}
    </span>
  );
}

/** The separator between header facts. */
function Dot({ onDark }: { onDark: boolean }) {
  return (
    <span aria-hidden className={onDark ? "text-white/40" : "text-[var(--fg-faint)]"}>
      ·
    </span>
  );
}
