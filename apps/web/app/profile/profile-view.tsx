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

// The finished header gradient, for the boot script to replay. The wash is sampled from a
// picture in IndexedDB, so without a replay the header is a flat dark band for several
// hundred milliseconds on every load. Both grounds go in, since the reader may switch.
const WASH_KEY = "timbre:profile-wash";

function recordWash(value: { dark: string; light: string } | null): void {
  try {
    if (value) window.localStorage.setItem(WASH_KEY, JSON.stringify(value));
    // Cleared, not left: a stale record paints a wash for a frame under a banner.
    else window.localStorage.removeItem(WASH_KEY);
  } catch {
    // Storage unavailable.
  }
}

// The counts line, recorded one text node at a time. Recorded whole, the stand-in was one
// flat run of dim text that React replaced with the same words in bold white digits — a
// visible change even though nothing arrived late. Per node, each figure sits in the
// element that styles it, so the first and settled paints are the same pixels.
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
    // Storage unavailable.
  }
}

/** The profile page — header wash, name, counts and saved playlists, all local. */
export function ProfileView({
  /** The name as the server knew it, from the cookie. Null if it was never set. */
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

  // Do not chain `profile.name || serverName` — that made clearing your display name bring
  // the old cookie value back, since the cookie is frozen at request time.
  const displayName = hydrated
    ? profile.name?.trim() || "Profile"
    : serverName?.trim() || "Profile";

  const playlistCount = playlists?.length ?? 0;
  const songCount = (playlists ?? []).reduce((total, list) => total + list.trackCount, 0);

  useEffect(() => {
    if (!settled) return;
    recordCounts({
      playlists: playlistCount.toLocaleString(),
      playlistsLabel: plural(playlistCount, "playlist"),
      songs: songCount.toLocaleString(),
      songsLabel: plural(songCount, "song"),
    });
  }, [settled, playlistCount, songCount]);

  // The avatar only, never cover art, or the wash settles on some album's blue while the
  // monogram in front of it stays orange.
  const sampled = useDominantColor(local.avatar);

  // `ready` waits on three separate arrivals — the local id (localStorage), the pictures
  // (IndexedDB) and the sampled colour (an image decode). Painting on each flashed the
  // header through three colours, starting with the placeholder id `"local"`; until then
  // the recorded wash stands in. `sampled.settled` rather than "is there a colour yet",
  // since a greyscale picture has no dominant hue and waiting for one never ends. A colour
  // already in hand counts too: the avatar's URL changes once per load — thumbnail, then
  // full copy — restarting sampling and dropping `settled` mid-load.
  const ready =
    Boolean(profile.id) && local.loaded && (sampled.settled || sampled.color !== null);
  const hue = sampled.color ? Math.round(sampled.color.h * 360) : avatarHue(profile.id || "local");
  const saturation = Math.min(0.58, Math.max(0.26, sampled.color?.s ?? AVATAR_TONE.saturation));

  // A dark gradient on a pastel palette drops a heavy band across a light page.
  const light = isLightTheme(useTheme());

  const stop = (lightness: number, satScale = 1) =>
    `hsl(${hue} ${Math.round(saturation * satScale * 100)}% ${lightness}%)`;

  // Three stops: a straight fade reads as a diagonal band across the middle.
  const washLight = `linear-gradient(to bottom, ${stop(84, 0.55)} 0%, ${stop(91, 0.4)} 45%, var(--surface-1) 100%)`;
  const washDark = `linear-gradient(to bottom, ${stop(34)} 0%, ${stop(22, 0.8)} 45%, var(--surface-1) 100%)`;
  const wash = light ? washLight : washDark;

  useEffect(() => {
    if (!ready) return;
    recordWash(local.banner ? null : { dark: washDark, light: washLight });
  }, [ready, local.banner, washDark, washLight]);

  // One flag, so the two cannot drift; a banner carries its own scrim.
  const onDark = Boolean(local.banner) || !light;

  function save(event: React.FormEvent) {
    event.preventDefault();
    setDisplayName(draft);
    setEditing(false);
  }

  return (
    <div className="@container w-full pb-16 sm:pb-20">
      <div
        className="group/banner relative isolate flex min-h-[14rem] w-full items-end transition-[background-image] duration-300 sm:min-h-[19rem] @lg:min-h-[21rem]"
        // `--profile-wash` is stamped by the boot script before the first paint, and unset
        // on a first visit, which leaves the page's own ground.
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
            {/* Two gradients kept separate — combined into one ramp, the light
                ground's fade to near-white dissolved the picture into a pale band. */}
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

        {/* Always visible on touch, where there is no hover; `focus-within` keeps the
            group up so tabbing to one does not hide it. */}
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2 opacity-100 transition @lg:opacity-0 @lg:focus-within:opacity-100 @lg:group-hover/banner:opacity-100">
          <SettingsPanel />
          {/* Positions the picker's error against the button. It cannot go on the
              cluster: that is `absolute`, and Tailwind emits `relative` after
              `absolute`, silently un-positioning the row. */}
          <span className="relative flex items-center">
            <ImagePicker kind="banner" hasImage={Boolean(local.banner)} variant="button" />
          </span>
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pb-5 pt-12 sm:px-7 sm:pb-7 sm:pt-20">
          <div className="flex flex-col gap-3 sm:gap-5 @lg:flex-row @lg:items-end @lg:gap-6">
            {/* `self-start` is load-bearing: this column is the cross axis until `@lg`
                turns the header into a row, so the circle stretched into a pill. The
                outer box must not clip — the picker's error sits below the avatar and
                was cropped to nothing inside the `overflow-hidden` circle, so a
                rejected file produced no visible response at all. */}
            <div className="group relative shrink-0 self-start">
              <div className="overflow-hidden rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.4)] ring-2 ring-white/20">
                {/* Paints the cached thumbnail from CSS before hydration, so no
                    monogram is shown on the way to a photograph. */}
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

              {/* `playlists?.length ?? 0` rendered a confident "0 playlists · 0 songs"
                  until storage answered, and zero is a real state here, so that is a
                  wrong answer rather than a placeholder. Gating on `settled` alone left
                  an empty line, so the figures are replayed from `recordCounts`. The row
                  is never conditional, only its slots, so nothing resizes between the
                  first and settled paint. */}
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

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-7">
        <h2 className="mb-3 mt-6 text-lg font-extrabold tracking-tight sm:mb-4 sm:mt-8 sm:text-xl">
          Playlists
        </h2>

        {/* Both possible shapes are in the markup and CSS picks the one this browser
            had last time, via `data-saved`. Skeleton tiles reserve the grid — rendering
            neither and then inserting one pushed the page down a frame after it had been
            drawn. A first visit matches neither rule and reserves nothing. */}
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

/** "playlist" or "playlists" — one rule, since the line is written twice. */
function plural(value: number, label: string): string {
  return `${label}${value === 1 ? "" : "s"}`;
}

function replay(source: string): React.CSSProperties {
  return { "--replay": `var(${source}, "")` } as React.CSSProperties;
}

// One figure in the header's stats line. `null` means "not counted yet", which is not
// zero: the nodes are left empty and CSS draws the recorded value in this element.
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

// A slot like the figures either side: the boot script only sets `--count-dot` when it
// has counts to put around it, since a lone middle dot is a worse frame than nothing.
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
