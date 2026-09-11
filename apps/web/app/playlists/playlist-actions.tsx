"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { MoreIcon, PencilIcon, TrashIcon } from "../icons";
import { deletePlaylist, renamePlaylist } from "./store";
import { useAnchoredMenu } from "./use-anchored-menu";

export function PlaylistActions({
  id,
  name,
  onDeletedGoTo,
  className,
}: {
  id: string;
  name: string;
  onDeletedGoTo?: string;
  className?: string;
}) {
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "rename" | "confirm">("menu");
  const [draft, setDraft] = useState(name);

  const at = useAnchoredMenu(open, root, menu, 240, mode);

  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  function toggle() {
    setOpen((was) => {
      if (!was) {
        setMode("menu");
        setDraft(name);
      }
      return !was;
    });
  }

  useEffect(() => {
    if (mode === "rename") renameInput.current?.select();
  }, [mode]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  function submitRename(event: React.FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (next && next !== name) renamePlaylist(id, next);
    close();
  }

  function confirmDelete() {
    deletePlaylist(id);
    close();
    if (onDeletedGoTo) router.push(onDeletedGoTo);
  }

  return (
    <div ref={root} className={`relative ${className ?? ""}`}>
      <button
        ref={trigger}
        type="button"
        onClick={toggle}
        aria-label={`Actions for ${name}`}
        aria-expanded={open}
        className="press flex size-9 items-center justify-center rounded-[var(--r-full)] text-[var(--fg-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
      >
        <MoreIcon className="size-5" />
      </button>

      {open && (
        <div
          ref={menu}
          role="menu"
          style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: "hidden" }}
          className="slab fixed z-50 w-60 overflow-hidden rounded-[var(--r-md)] bg-[var(--surface-1)] shadow-[var(--drop-lg)]"
        >
          {mode === "menu" && (
            <div className="p-1.5">
              <button
                type="button"
                role="menuitem"
                onClick={() => setMode("rename")}
                className="flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-left text-[13px] font-medium hover:bg-[var(--surface-2)]"
              >
                <PencilIcon className="size-4 shrink-0 text-[var(--fg-dim)]" />
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setMode("confirm")}
                className="flex w-full items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-left text-[13px] font-medium text-red-400 hover:bg-[var(--surface-2)]"
              >
                <TrashIcon className="size-4 shrink-0" />
                Delete playlist
              </button>
            </div>
          )}

          {mode === "rename" && (
            <form onSubmit={submitRename} className="flex flex-col gap-2 p-2.5">
              <label htmlFor={`rename-${id}`} className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-dim)]">
                Rename
              </label>
              <input
                id={`rename-${id}`}
                ref={renameInput}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={120}
                autoFocus
                className="w-full rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2.5 py-2 text-[13px] outline-none"
              />
              <div className="flex gap-1.5">
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="slab-sm press flex-1 rounded-[var(--r-sm)] px-2.5 py-1.5 text-[12px] font-bold text-[var(--accent-fg)] disabled:opacity-40"
                  style={{ background: "var(--accent)" }}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  className="press rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] font-semibold"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {mode === "confirm" && (
            <div className="flex flex-col gap-2 p-2.5">
              <p className="text-[13px] leading-relaxed">
                Delete <span className="font-bold">{name}</span>?
              </p>
              <p className="text-[11px] leading-relaxed text-[var(--fg-faint)]">
                The songs stay searchable — only the list goes.
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  className="press flex-1 rounded-[var(--r-sm)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12px] font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmDelete()}
                  className="slab-sm press rounded-[var(--r-sm)] bg-red-500/90 px-2.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
