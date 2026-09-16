import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_IMAGE_CHARS } from "../customise/replay.ts";
import { getBackground, hasBackgroundImage, subscribeBackground, THUMB_KEY } from "./background.ts";

/**
 * `thumb()` used to take anything beginning `data:image/`, of any length, and hand it to
 * `paint()`, which splices it into `--app-bg-image` as `url(...)`. The pre-paint script in
 * layout.tsx reads the same key and has always demanded base64 of a raster type under 700,000
 * characters, so the hydrated path accepted values the boot script refused.
 *
 * Closing that gap can only be right if it costs the reader nothing, so the first test below is
 * the important one: every shape the boot script replays has to still arrive on the page. The
 * two `CANVAS_*` fixtures are real output from Chrome's own encoder, captured from the exact
 * call `redraw()` makes — `canvas.toDataURL("image/webp"|"image/jpeg", 0.5)` — because those are
 * the only two values `setBackgroundImage`, the single writer of this key, can ever store.
 */
const CANVAS_WEBP =
  "data:image/webp;base64,UklGRjICAABXRUJQVlA4WAoAAAAgAAAABwAABQAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggRAAAANABAJ0BKggABgACwEwlsAJ0MEABPY3wAP5P3r7k//pG+qp9N5nm8fp6pH9qMbx83n5cB50Nyizgw2h8YfRBavlUAAAA";
const CANVAS_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAGAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAeEAABAwQDAAAAAAAAAAAAAAACAAEDBBIhQQURYf/EABUBAQEAAAAAAAAAAAAAAAAAAAME/8QAFxEAAwEAAAAAAAAAAAAAAAAAAAECMf/aAAwDAQACEQMRAD8AhSVcJ8ZFSjSAMoHcU7dXE2cPj1t6REV8ypwQ/9k=";

/**
 * Points the module at a browser holding `value`, and invalidates the read it caches for the
 * life of the process — through the app's own `storage` listener, which is what a second tab
 * editing the same key does.
 */
function stored(value: string | null): void {
  const backing: Record<string, string> = value === null ? {} : { [THUMB_KEY]: value };
  const handlers: ((event: StorageEvent) => void)[] = [];
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (key: string) => backing[key] ?? null,
      setItem: (key: string, item: string) => {
        backing[key] = item;
      },
      removeItem: (key: string) => {
        delete backing[key];
      },
    },
    addEventListener: (type: string, handler: (event: StorageEvent) => void) => {
      if (type === "storage") handlers.push(handler);
    },
    removeEventListener: () => {},
  };
  subscribeBackground(() => {});
  for (const handler of handlers) handler({ key: THUMB_KEY } as StorageEvent);
}

const payload = (chars: number): string => "A".repeat(chars);
const atLimit = `data:image/png;base64,${payload(MAX_IMAGE_CHARS - "data:image/png;base64,".length)}`;

/**
 * Everything `isReplayableImage` accepts, enumerated from its own pattern: five raster types, a
 * base64 payload over the whole alphabet, nought to two `=` of padding, up to 700,000 characters
 * — plus the two values Chrome's encoder actually produces for a Timbre thumbnail.
 */
const REPLAYABLE: [string, string][] = [
  ["png", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="],
  ["jpeg", "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD="],
  ["webp", "data:image/webp;base64,UklGRhIAAABXRUJQVlA4TAYAAAAvAAAAAA"],
  ["gif", "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5"],
  ["avif", "data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYx"],
  ["no padding", "data:image/png;base64,QUJDRA"],
  ["one pad", "data:image/png;base64,QUJDRUY="],
  ["two pad", "data:image/png;base64,QUJDRQ=="],
  ["the whole base64 alphabet", `data:image/png;base64,${"+/"}ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789==`],
  ["exactly the cap", atLimit],
  ["what the canvas encodes, webp", CANVAS_WEBP],
  ["what the canvas encodes, jpeg", CANVAS_JPEG],
];

test("every picture the boot script replays still reaches the page", () => {
  assert.equal(atLimit.length, MAX_IMAGE_CHARS);
  for (const [name, value] of REPLAYABLE) {
    stored(value);
    assert.equal(hasBackgroundImage(), true, `${name} stopped counting as a background`);
    assert.equal(getBackground(), value, `${name} stopped being painted`);
  }
});

/**
 * The other half: values the pre-paint script has always refused, which the hydrated path was
 * taking. None of these can come out of the picker — `setBackgroundImage` writes `toDataURL`
 * output and nothing else — so refusing them costs no reader a picture they chose.
 */
const REFUSED: [string, string][] = [
  ["an SVG, which is a document rather than a raster", "data:image/svg+xml;base64,PHN2Zy8+"],
  ["a second url() spliced onto the end", 'data:image/png;base64,AA") , url("https://planted.example/pixel.png'],
  ["one character over the cap", `${atLimit}A`],
  ["a data: URL that is not base64 at all", "data:image/png,%89PNG%0D%0A"],
  ["whitespace inside the payload", "data:image/png;base64,QUJD RA=="],
  ["a remote host", "https://planted.example/pixel.png"],
  ["a blob: URL, which cannot outlive the document that minted it", "blob:http://localhost/9b1c"],
  ["nothing at all", ""],
];

test("a value the boot script would refuse is no longer painted after hydration either", () => {
  for (const [name, value] of REFUSED) {
    stored(value);
    assert.equal(hasBackgroundImage(), false, `${name} still counts as a background`);
    assert.equal(getBackground(), null, `${name} is still painted`);
  }
});

test("no stored picture at all is still no picture", () => {
  stored(null);
  assert.equal(hasBackgroundImage(), false);
  assert.equal(getBackground(), null);
});
