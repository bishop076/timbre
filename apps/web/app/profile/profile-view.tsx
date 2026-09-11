"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { sampleHue, type Hsl } from "../hue";
import { useHydrated } from "../hydrated";
import { CheckIcon, PencilIcon } from "../icons";
import { EmptyNotice } from "../page-chrome";
import { PLAYLIST_GRID, PlaylistGrid } from "../playlists/library-view";
import { loadPlaylists, usePlaylists } from "../playlists/store";
import { isLightTheme, useTheme } from "../theme/theme-store";
import { Avatar, AVATAR_TONE, avatarHue } from "./avatar";
import { ImagePicker } from "./image-picker";
import { useLocalImages } from "./local-images";
import { setDisplayName, useLocalProfile } from "./local-profile";
import { SettingsPanel } from "./settings-panel";

function remember(key: string, value: object | null): void {
  try {
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {}
}

function plural(value: number, label: string): string {
  return `${label}${value === 1 ? "" : "s"}`;
}

function useDominantColor(src: string | null) {
  const [found, setFound] = useState<{ src: string; color: Hsl | null } | null>(null);

  useEffect(() => {
    if (!src) return;
    return sampleHue(src, (color) => setFound({ src, color }));
  }, [src]);

  if (!src) return { color: null, settled: true };
  return { color: found?.color ?? null, settled: found?.src === src };
}

const BANNER_SCRIM =
  "linear-gradient(to top, var(--surface-1) 0%, transparent var(--banner-fade, 45%)), " +
  "linear-gradient(to top, rgb(0 0 0 / 0.45) 0%, rgb(0 0 0 / 0.1) 100%)";

export function ProfileView({ serverName }: { serverName: string | null }) {
  const profile = useLocalProfile();
  const local = useLocalImages();
  const { playlists, settled } = usePlaylists();
  const hydrated = useHydrated();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    loadPlaylists();
  }, []);

  const displayName = (hydrated ? profile.name : serverName)?.trim() || "Profile";

  const playlistCount = playlists?.length ?? 0;
  const songCount = (playlists ?? []).reduce((total, list) => total + list.trackCount, 0);

  useEffect(() => {
    if (!settled) return;
    remember("timbre:profile-counts", {
      playlists: playlistCount.toLocaleString(),
      playlistsLabel: plural(playlistCount, "playlist"),
      songs: songCount.toLocaleString(),
      songsLabel: plural(songCount, "song"),
    });
  }, [settled, playlistCount, songCount]);

  const sampled = useDominantColor(local.avatar);

  const ready =
    Boolean(profile.id) && local.loaded && (sampled.settled || sampled.color !== null);
  const hue = sampled.color ? Math.round(sampled.color.h * 360) : avatarHue(profile.id || "local");
  const saturation = Math.min(0.58, Math.max(0.26, sampled.color?.s ?? AVATAR_TONE.saturation));

  const light = isLightTheme(useTheme());

  const stop = (lightness: number, satScale = 1) =>
    `hsl(${hue} ${Math.round(saturation * satScale * 100)}% ${lightness}%)`;

  const washLight = `linear-gradient(to bottom, ${stop(84, 0.55)} 0%, ${stop(91, 0.4)} 45%, var(--surface-1) 100%)`;
  const washDark = `linear-gradient(to bottom, ${stop(34)} 0%, ${stop(22, 0.8)} 45%, var(--surface-1) 100%)`;
  const wash = light ? washLight : washDark;

  useEffect(() => {
    if (!ready) return;
    remember("timbre:profile-wash", local.banner ? null : { dark: washDark, light: washLight });
  }, [ready, local.banner, washDark, washLight]);

  const onDark = Boolean(local.banner) || !light;
  const strong = onDark ? "text-white" : "text-[var(--fg)]";

  function save(event: React.FormEvent) {
    event.preventDefault();
    setDisplayName(draft);
    setEditing(false);
  }

  return (
    <div className="@container w-full pb-16 sm:pb-20">
      <div
        className="group/banner relative isolate flex min-h-[14rem] w-full items-end transition-[background-image] duration-300 sm:min-h-[19rem] @lg:min-h-[21rem]"
        style={
          local.banner
            ? undefined
            : { backgroundImage: ready ? wash : "var(--profile-wash, none)" }
        }
      >
        {local.banner ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={local.banner} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
            <div aria-hidden className="absolute inset-0 -z-10" style={{ background: BANNER_SCRIM }} />
          </>
        ) : !hydrated ? (
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-cover bg-center"
            style={{ backgroundImage: `${BANNER_SCRIM}, var(--banner-thumb)` }}
          />
        ) : null}

        <div className="absolute right-4 top-4 z-20 flex items-center gap-2 opacity-100 transition @lg:opacity-0 @lg:focus-within:opacity-100 @lg:group-hover/banner:opacity-100">
          <SettingsPanel />
          <span className="relative flex items-center">
            <ImagePicker kind="banner" hasImage={Boolean(local.banner)} variant="button" />
          </span>
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pb-5 pt-12 sm:px-7 sm:pb-7 sm:pt-20">
          <div className="flex flex-col gap-3 sm:gap-5 @lg:flex-row @lg:items-end @lg:gap-6">
            <div className="group relative shrink-0 self-start">
              <div className="overflow-hidden rounded-full shadow-[0_4px_20px_rgba(0,0,0,0.4)] ring-2 ring-white/20">
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
              {editing ? (
                <form onSubmit={save} className="flex max-w-sm flex-col gap-2">
                  <h1 className="sr-only">{displayName}</h1>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setEditing(false);
                    }}
                    maxLength={60}
                    autoFocus
                    aria-label="Display name"
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
                <>
                  <p
                    className={`mb-1.5 text-[11px] font-bold uppercase tracking-wider ${onDark ? "text-white/80" : "text-[var(--fg-dim)]"}`}
                  >
                    Profile
                  </p>

                  <div className="flex items-center gap-3">
                    <h1
                      className={`min-w-0 break-words font-extrabold leading-[1.05] tracking-tight ${strong} ${
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

                  <div
                    className={`mt-3.5 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm ${onDark ? "text-white/75" : "text-[var(--fg-dim)]"}`}
                  >
                    <span>
                      <Replay
                        slot="count-playlists"
                        value={settled ? playlistCount.toLocaleString() : null}
                        className={`font-bold tabular-nums ${strong}`}
                      />{" "}
                      <Replay
                        slot="label-playlists"
                        value={settled ? plural(playlistCount, "playlist") : null}
                      />
                    </span>
                    <Replay
                      slot="count-dot"
                      value={settled ? "·" : null}
                      className={onDark ? "text-white/40" : "text-[var(--fg-faint)]"}
                      decorative
                    />
                    <span>
                      <Replay
                        slot="count-songs"
                        value={settled ? songCount.toLocaleString() : null}
                        className={`font-bold tabular-nums ${strong}`}
                      />{" "}
                      <Replay slot="label-songs" value={settled ? plural(songCount, "song") : null} />
                    </span>
                    <Link
                      href="/stats"
                      className={`press ml-1 rounded-[var(--r-full)] px-2.5 py-0.5 text-[12px] font-semibold ${onDark ? "bg-white/10 text-white hover:bg-white/20" : "bg-[var(--surface-2)] text-[var(--fg)] hover:bg-[var(--surface-3)]"}`}
                    >
                      Your listening
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-7">
        <h2 className="mb-3 mt-6 text-lg font-extrabold tracking-tight sm:mb-4 sm:mt-8 sm:text-xl">
          Playlists
        </h2>

        {settled && playlists?.length ? (
          <PlaylistGrid playlists={playlists} />
        ) : (
          <>
            <EmptyNotice className={settled ? undefined : "saved-none"}>Nothing saved yet.</EmptyNotice>
            {!settled && (
              <ul aria-hidden className={`saved-some ${PLAYLIST_GRID}`}>
                {Array.from({ length: 5 }, (_, index) => (
                  <li key={index} className="p-2.5">
                    <div className="aspect-square w-full animate-pulse rounded-[var(--r-md)] bg-[var(--surface-2)]" />
                    <div className="mt-2.5 h-3.5 w-3/4 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
                    <div className="mt-1.5 h-3 w-2/5 animate-pulse rounded-[var(--r-sm)] bg-[var(--surface-2)]" />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Replay({
  slot,
  value,
  className = "",
  decorative = false,
}: {
  slot: "count-playlists" | "label-playlists" | "count-songs" | "label-songs" | "count-dot";
  value: string | null;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <span
      aria-hidden={decorative || undefined}
      className={`replay ${className}`}
      style={{ "--replay": `var(--${slot}, "")` } as React.CSSProperties}
    >
      {value}
    </span>
  );
}
