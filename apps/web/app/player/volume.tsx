"use client";

import { useEffect, useRef, useState } from "react";

import { VolumeIcon, VolumeMuteIcon } from "../icons";
import { usePlayer } from "./player-context";
import { VOLUME_STEP } from "./transport-keys";
import { pixelDelta, wheelSteps } from "./wheel-step";

/**
 * Output level.
 *
 * Desktop only, and that is not an omission: on a phone the hardware keys own
 * volume, and every phone music app leaves it to them rather than offering a
 * second control that fights the first.
 *
 * The button mutes, the track sets a level, and muting is drawn as a level of
 * zero rather than as a separate state — one reading, so the control can never
 * show a level you cannot hear.
 */
export function Volume() {
  const { volume, muted, setVolume, toggleMute } = usePlayer();
  const trackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const level = muted ? 0 : volume;

  const applyFrom = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 1) return;
    /*
     * Divided by `width - 1`, not `width`.
     *
     * A track is `width` pixels wide but its addressable positions run from 0
     * to `width - 1`, so dividing by the full width means the furthest a
     * pointer can land maps to 63/64 rather than 64/64. Dragging to the far
     * right produced **98** on the narrow bar and 99 on the wide one — a fill
     * that renders as visually full while the audio sits under maximum, which
     * is exactly the kind of gap nobody thinks to check.
     *
     * Mapping the last pixel to 100 makes both ends reachable by the control's
     * primary gesture. `setVolume` clamps, so overshoot from sub-pixel pointer
     * coordinates is already handled.
     */
    setVolume(((clientX - box.left) / (box.width - 1)) * 100);
  };

  /*
   * The current level, for the wheel handler to read.
   *
   * `setVolume` takes an absolute value rather than an updater, so a handler
   * closing over `level` would work from a stale number the moment two wheel
   * events land in one frame — which is every trackpad flick. A ref is always
   * the latest, and it keeps the listener out of the effect's dependencies so
   * it is attached once rather than re-bound on every volume change.
   */
  const levelRef = useRef(level);
  useEffect(() => {
    levelRef.current = level;
  }, [level]);

  /*
   * Scroll to change the volume.
   *
   * A **native** listener with `passive: false`, not React's `onWheel`. React
   * registers wheel handlers at the root as passive, so `preventDefault` inside
   * one is ignored — with a warning in development and silently in production.
   * Without preventing the default, scrolling over the control adjusts the
   * volume *and* scrolls the page behind it.
   *
   * Bound to the whole control, button included, so the target is the visible
   * cluster rather than only the 10px bar.
   */
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;

    let carried = 0;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();

      carried += pixelDelta(event.deltaY, event.deltaMode);
      const { steps, rest } = wheelSteps(carried);
      carried = rest;
      if (steps === 0) return;

      // Scrolling up is a negative delta and means louder, which is why this
      // subtracts. `setVolume` clamps and unmutes, so a muted control comes
      // back at the level being scrolled to rather than staying silent.
      setVolume(levelRef.current - steps * VOLUME_STEP);
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [setVolume]);

  return (
    <div ref={rootRef} className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute" : "Mute"}
        aria-pressed={muted}
        className="slab-sm press flex size-8 items-center justify-center rounded-[var(--r-md)] bg-[var(--surface-2)] text-[var(--fg)]"
      >
        {muted ? <VolumeMuteIcon className="size-[18px]" /> : <VolumeIcon className="size-[18px]" />}
      </button>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        // Scrolling has no visible affordance, so the tooltip is the only place
        // it is discoverable by anyone who does not try it.
        title="Volume — drag, or scroll to adjust"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        aria-valuetext={muted ? "Muted" : `${level}%`}
        // Pointer capture rather than window listeners: the pointer keeps
        // reporting to this element once it is captured, so a drag that leaves
        // the track — which is most drags on a control this small — keeps
        // working instead of stopping at the edge.
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          applyFrom(event.clientX);
        }}
        onPointerMove={(event) => {
          if (dragging) applyFrom(event.clientX);
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") setVolume(level + 5);
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") setVolume(level - 5);
          if (event.key === "Home") setVolume(0);
          if (event.key === "End") setVolume(100);
        }}
        // The hit area is taller than the visible bar, because a 10px target is
        // unusable with a mouse.
        className="group flex h-8 w-16 cursor-pointer touch-none items-center xl:w-24"
      >
        <div className="slab-sm relative h-2.5 w-full overflow-hidden rounded-[var(--r-full)] bg-[var(--surface-2)]">
          <div
            className="tint absolute inset-y-0 left-0 rounded-[var(--r-full)]"
            style={{ width: `${level}%`, background: "var(--accent)" }}
          />
        </div>
      </div>
    </div>
  );
}
