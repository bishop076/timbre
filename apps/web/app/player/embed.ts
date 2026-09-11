"use client";

import { useEffect, useRef } from "react";

import { usePlayerControls } from "./player-context";

export function loadOnce<T>(
  start: (resolve: (value: T) => void, reject: (cause: Error) => void) => void,
): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () =>
    (pending ??= new Promise(start).catch((cause: unknown) => {
      pending = null;
      throw cause;
    }));
}

export function findScript(src: string): HTMLScriptElement | null {
  return document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
}

export function addScript(src: string, parent: HTMLElement = document.head): HTMLScriptElement {
  const script = Object.assign(document.createElement("script"), { src });
  parent.append(script);
  return script;
}

export function loadGlobal<T>(src: string, read: () => T | undefined): () => Promise<T> {
  return loadOnce((resolve, reject) => {
    const loaded = read();
    if (loaded) return resolve(loaded);
    const script = findScript(src) ?? addScript(src);
    script.addEventListener("load", () => {
      const api = read();
      if (api) resolve(api);
      else reject(new Error(`${src} loaded without its API.`));
    });
    script.addEventListener("error", () => reject(new Error(`${src} was blocked.`)));
  });
}

export const blockedReason = (service: string) =>
  `Couldn't load ${service}'s player. An ad blocker or network filter may be blocking it.`;

export function blockedTimer(service: string, report: (reason: string) => void): () => void {
  const timer = setTimeout(() => report(blockedReason(service)), 8000);
  return () => clearTimeout(timer);
}

export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function useTransport(
  transport: { toggle: () => void; seek: (seconds: number) => void } | null,
  active = true,
): void {
  const { registerToggle, registerSeek } = usePlayerControls();
  const latest = useLatest(transport);
  useEffect(() => {
    if (!active) return;
    registerToggle(latest.current?.toggle ?? null);
    registerSeek(latest.current?.seek ?? null);
    return () => {
      registerToggle(null);
      registerSeek(null);
    };
  }, [active, latest, registerToggle, registerSeek]);
}
