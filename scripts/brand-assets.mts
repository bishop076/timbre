#!/usr/bin/env node

// Generates docs/brand/logo/** — the mark, the wordmark and the lockup, in every colourway, as
// SVG (always) and PNG (when sharp can be found).
//
// The wordmark is normally drawn by Satori from two .woff files, which means it only exists inside
// a rendered banner: there was no "give me the logo" file, and anyone wanting one had to stand up
// a Next dev server. This converts the glyphs to outlines instead, so the shipped SVGs carry no
// font dependency and render the same in a browser, in Figma, and in whatever a label printer uses.
//
// The outlines are not a redraw. `tim`/`bre` are laid out with the same measured constants as
// docs/brand/banners/readme-banner.tsx, and the result was checked against the shipped banner
// pixel by pixel: every letter lands within 1px and no disagreement sits more than 2px from a mask
// edge, i.e. the difference is antialiasing and nothing else. Re-check with --verify after
// touching any constant here.
//
// Fonts are parsed rather than pulled from a library because the repo has no font dependency and
// adding one to the lockfile costs every other session an install. Three tables do the work —
// cmap for char->glyph, loca+glyf for outlines, hmtx for advances — and all three faces are
// TrueType-flavoured (glyf, quadratic), which is the easy case. A CFF/OTF face would not parse
// here and would need a real library.

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { inflateSync } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const at = (p: string) => resolve(root, p);
const FONT_DIR = "apps/web/app/brand-fonts";
const OUT = "docs/brand/logo";

// ---------------------------------------------------------------- font parsing

type Point = { x: number; y: number; on: boolean };
type Face = {
  unitsPerEm: number;
  ascender: number;
  descender: number;
  glyph: (ch: string) => number;
  outline: (gid: number) => Point[][];
  advance: (gid: number) => number;
};

function woffTables(file: string): Record<string, Buffer> {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "wOFF") throw new Error(`not a WOFF: ${file}`);
  const tables: Record<string, Buffer> = {};
  const count = b.readUInt16BE(12);
  for (let i = 0; i < count; i++) {
    const o = 44 + i * 20;
    const tag = b.toString("ascii", o, o + 4);
    const offset = b.readUInt32BE(o + 4);
    const compressed = b.readUInt32BE(o + 8);
    const original = b.readUInt32BE(o + 12);
    const slice = b.subarray(offset, offset + compressed);
    // WOFF stores a table raw when compressing it would not have helped.
    tables[tag] = compressed < original ? inflateSync(slice) : slice;
  }
  return tables;
}

function table(t: Record<string, Buffer>, tag: string): Buffer {
  const found = t[tag];
  if (!found) throw new Error(`missing ${tag} table`);
  return found;
}

function parseFace(file: string): Face {
  const t = woffTables(file);
  const head = table(t, "head");
  const glyf = table(t, "glyf");
  const hhea = table(t, "hhea");
  const hmtx = table(t, "hmtx");
  const unitsPerEm = head.readUInt16BE(18);
  const longLoca = head.readInt16BE(50) !== 0;
  const numGlyphs = table(t, "maxp").readUInt16BE(4);
  const hMetrics = hhea.readUInt16BE(34);

  const locaTable = table(t, "loca");
  const loca: number[] = [];
  for (let i = 0; i <= numGlyphs; i++) {
    loca.push(longLoca ? locaTable.readUInt32BE(i * 4) : locaTable.readUInt16BE(i * 2) * 2);
  }

  // cmap format 4, from a Unicode or Windows subtable. Enough for Latin; these are Latin faces.
  const cmap = table(t, "cmap");
  let sub = -1;
  for (let i = 0; i < cmap.readUInt16BE(2); i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const offset = cmap.readUInt32BE(8 + i * 8);
    if (cmap.readUInt16BE(offset) === 4 && (platform === 3 || platform === 0)) sub = offset;
  }
  if (sub < 0) throw new Error(`no format 4 cmap in ${file}`);
  const segX2 = cmap.readUInt16BE(sub + 6);
  const endO = sub + 14;
  const startO = endO + segX2 + 2;
  const deltaO = startO + segX2;
  const rangeO = deltaO + segX2;

  const glyph = (ch: string) => {
    const cp = ch.codePointAt(0) ?? 0;
    for (let i = 0; i < segX2 / 2; i++) {
      if (cmap.readUInt16BE(endO + i * 2) < cp) continue;
      const start = cmap.readUInt16BE(startO + i * 2);
      if (start > cp) return 0;
      const delta = cmap.readInt16BE(deltaO + i * 2);
      const range = cmap.readUInt16BE(rangeO + i * 2);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = cmap.readUInt16BE(rangeO + i * 2 + range + (cp - start) * 2);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };

  function outline(gid: number, depth = 0): Point[][] {
    const start = loca[gid];
    const end = loca[gid + 1];
    if (start === undefined || end === undefined || start === end) return [];
    const g = glyf.subarray(start, end);
    const contourCount = g.readInt16BE(0);

    if (contourCount < 0) {
      // Composite glyph: components, each with an offset and an optional 2x2 transform.
      if (depth > 4) return [];
      const out: Point[][] = [];
      let p = 10;
      for (;;) {
        const flags = g.readUInt16BE(p);
        const index = g.readUInt16BE(p + 2);
        p += 4;
        let dx: number;
        let dy: number;
        if (flags & 0x0001) {
          dx = g.readInt16BE(p);
          dy = g.readInt16BE(p + 2);
          p += 4;
        } else {
          dx = g.readInt8(p);
          dy = g.readInt8(p + 1);
          p += 2;
        }
        let a = 1;
        let b = 0;
        let c = 0;
        let d = 1;
        const f2 = (v: number) => v / 16384;
        if (flags & 0x0008) {
          a = d = f2(g.readInt16BE(p));
          p += 2;
        } else if (flags & 0x0040) {
          a = f2(g.readInt16BE(p));
          d = f2(g.readInt16BE(p + 2));
          p += 4;
        } else if (flags & 0x0080) {
          a = f2(g.readInt16BE(p));
          b = f2(g.readInt16BE(p + 2));
          c = f2(g.readInt16BE(p + 4));
          d = f2(g.readInt16BE(p + 6));
          p += 8;
        }
        for (const contour of outline(index, depth + 1)) {
          out.push(contour.map((pt) => ({ x: a * pt.x + c * pt.y + dx, y: b * pt.x + d * pt.y + dy, on: pt.on })));
        }
        if (!(flags & 0x0020)) break;
      }
      return out;
    }

    const ends: number[] = [];
    for (let i = 0; i < contourCount; i++) ends.push(g.readUInt16BE(10 + i * 2));
    const last = ends[contourCount - 1];
    if (last === undefined) return [];
    const total = last + 1;

    let p = 10 + contourCount * 2;
    p += 2 + g.readUInt16BE(p); // instructions

    const flags: number[] = [];
    while (flags.length < total) {
      const f = g.readUInt8(p++);
      flags.push(f);
      if (f & 0x08) {
        let repeat = g.readUInt8(p++);
        while (repeat-- > 0) flags.push(f);
      }
    }

    const read = (shortBit: number, sameBit: number) => {
      const values: number[] = [];
      let v = 0;
      for (const f of flags) {
        if (f & shortBit) {
          const delta = g.readUInt8(p++);
          v += f & sameBit ? delta : -delta;
        } else if (!(f & sameBit)) {
          v += g.readInt16BE(p);
          p += 2;
        }
        values.push(v);
      }
      return values;
    };
    const xs = read(0x02, 0x10);
    const ys = read(0x04, 0x20);

    const contours: Point[][] = [];
    let from = 0;
    for (const to of ends) {
      const pts: Point[] = [];
      for (let i = from; i <= to; i++) {
        pts.push({ x: xs[i] ?? 0, y: ys[i] ?? 0, on: ((flags[i] ?? 0) & 0x01) !== 0 });
      }
      contours.push(pts);
      from = to + 1;
    }
    return contours;
  }

  return {
    unitsPerEm,
    ascender: hhea.readInt16BE(4),
    descender: hhea.readInt16BE(6),
    glyph,
    outline,
    advance: (gid) => hmtx.readUInt16BE(Math.min(gid, hMetrics - 1) * 4),
  };
}

// ------------------------------------------------------------------- outlines

type Box = { x0: number; y0: number; x1: number; y1: number };

const round = (v: number) => Math.round(v * 1000) / 1000;

// A TrueType contour is a ring of on- and off-curve points where two consecutive off-curve points
// imply an on-curve midpoint between them. Expanding those first turns the ring into a plain
// alternating sequence, which is what an SVG quadratic path wants.
function normalise(raw: Point[]): Point[] {
  const dense: Point[] = [];
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    const next = raw[(i + 1) % raw.length];
    if (!cur || !next) continue;
    dense.push(cur);
    if (!cur.on && !next.on) dense.push({ x: (cur.x + next.x) / 2, y: (cur.y + next.y) / 2, on: true });
  }
  const first = dense.findIndex((p) => p.on);
  return first < 0 ? [] : [...dense.slice(first), ...dense.slice(0, first)];
}

// Exact bounds of a quadratic segment: the curve leaves the hull of its endpoints only at the t
// where the derivative crosses zero, so test that one point per axis rather than the control point
// (which overstates the box, sometimes by several units at display sizes).
function quadBounds(p0: number, c: number, p1: number): [number, number] {
  let lo = Math.min(p0, p1);
  let hi = Math.max(p0, p1);
  const denom = p0 - 2 * c + p1;
  if (denom !== 0) {
    const t = (p0 - c) / denom;
    if (t > 0 && t < 1) {
      const v = (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * c + t * t * p1;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}

type Drawn = { d: string; box: Box };

function drawContours(contours: Point[][]): Drawn {
  const out: string[] = [];
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const see = (x: number, y: number) => {
    if (x < box.x0) box.x0 = x;
    if (x > box.x1) box.x1 = x;
    if (y < box.y0) box.y0 = y;
    if (y > box.y1) box.y1 = y;
  };

  for (const contour of contours) {
    const seq = normalise(contour);
    const head = seq[0];
    if (!head) continue;
    out.push(`M${round(head.x)} ${round(head.y)}`);
    see(head.x, head.y);
    let cursor = head;
    let i = 1;
    while (i <= seq.length) {
      const p = seq[i % seq.length];
      if (!p) break;
      if (p.on) {
        out.push(`L${round(p.x)} ${round(p.y)}`);
        see(p.x, p.y);
        cursor = p;
        i += 1;
      } else {
        const end = seq[(i + 1) % seq.length];
        if (!end) break;
        out.push(`Q${round(p.x)} ${round(p.y)} ${round(end.x)} ${round(end.y)}`);
        const [xl, xh] = quadBounds(cursor.x, p.x, end.x);
        const [yl, yh] = quadBounds(cursor.y, p.y, end.y);
        see(xl, yl);
        see(xh, yh);
        cursor = end;
        i += 2;
      }
    }
    out.push("Z");
  }
  return { d: out.join(""), box };
}

// ------------------------------------------------------- the lockup, as drawn

const HEAD = parseFace(at(`${FONT_DIR}/DeliciousHandrawn.woff`));
const GLUTEN = parseFace(at(`${FONT_DIR}/Gluten.woff`));

// From docs/brand/banners/readme-banner.tsx. Do not tune these by eye — see docs/brand/type.
const HEAD_TRACK = -0.02;
const BRE_SCALE = 0.94;
const BRE_DROP = 0.209;

// The palm's size and its gap from the wordmark, as fractions of the head size. Height and the
// 0.34 come straight from the banner. The gap does not: the banner spaces the palm off the `bre`
// span's *advance* box, and reproducing Satori's box model exactly (trailing letter-spacing,
// half-leading) put it 2.5px right of where the banner actually draws it. Measuring the shipped
// PNG instead — ink of the `e` ends at x=452, ink of the palm starts at x=461, at size 126 — is
// both simpler and the thing that is actually true of the artwork. Same approach as BRE_DROP.
const MARK_SIZE = 0.34;
const MARK_GAP = 9 / 126;

// Satori centres the ascender..descender box inside the line box and drops the baseline an
// ascender below that, so a span with lineHeight 1 puts its baseline here.
function baselineIn(f: Face, fontSize: number) {
  const s = fontSize / f.unitsPerEm;
  const asc = f.ascender * s;
  const desc = f.descender * s;
  return (fontSize - (asc - desc)) / 2 + asc;
}

function runOf(f: Face, text: string, fontSize: number, tracking: number) {
  const s = fontSize / f.unitsPerEm;
  const pieces: string[] = [];
  const box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  let pen = 0;
  for (const ch of text) {
    const gid = f.glyph(ch);
    const { d, box: gb } = drawContours(f.outline(gid));
    if (d) {
      pieces.push(`<path d="${d}" transform="translate(${round(pen)} 0) scale(${round(s)} ${round(-s)})"/>`);
      box.x0 = Math.min(box.x0, pen + gb.x0 * s);
      box.x1 = Math.max(box.x1, pen + gb.x1 * s);
      // y flips: the glyph's top edge is its largest font-unit y.
      box.y0 = Math.min(box.y0, -gb.y1 * s);
      box.y1 = Math.max(box.y1, -gb.y0 * s);
    }
    pen += f.advance(gid) * s + tracking;
  }
  return { pieces, advance: pen - tracking, box };
}

const MARK_PATH = (() => {
  const src = readFileSync(at("apps/web/app/shell/brand.tsx"), "utf8");
  const found = / d="([^"]+)"/.exec(src)?.[1];
  if (!found) throw new Error("no path data in apps/web/app/shell/brand.tsx");
  return found;
})();
const MARK_VIEW = { w: 247, h: 282 };

// Everything below is built at this size and then scaled by the viewBox, so the number only sets
// the precision of the emitted coordinates. 126 is what the banner uses.
const SIZE = 126;

type Piece = { svg: string; box: Box };

function wordmarkPieces(): Piece {
  const breSize = SIZE * BRE_SCALE;
  const tim = runOf(HEAD, "tim", SIZE, SIZE * HEAD_TRACK);
  const bre = runOf(GLUTEN, "bre", breSize, -SIZE * 0.012);
  const timY = baselineIn(HEAD, SIZE);
  const breY = SIZE * BRE_DROP + baselineIn(GLUTEN, breSize);
  const breX = tim.advance + SIZE * 0.02;

  return {
    svg:
      `<g transform="translate(0 ${round(timY)})">${tim.pieces.join("")}</g>` +
      `<g transform="translate(${round(breX)} ${round(breY)})">${bre.pieces.join("")}</g>`,
    box: {
      x0: Math.min(tim.box.x0, breX + bre.box.x0),
      x1: Math.max(tim.box.x1, breX + bre.box.x1),
      y0: Math.min(timY + tim.box.y0, breY + bre.box.y0),
      y1: Math.max(timY + tim.box.y1, breY + bre.box.y1),
    },
  };
}

function markPiece(x: number, y: number, height: number): Piece {
  const s = height / MARK_VIEW.h;
  return {
    svg: `<path d="${MARK_PATH}" transform="translate(${round(x)} ${round(y)}) scale(${round(s)})"/>`,
    box: { x0: x, y0: y, x1: x + MARK_VIEW.w * s, y1: y + height },
  };
}

// ------------------------------------------------------------------- emitting

const PAD = 0; // logo files are cut to the ink; callers do their own clear space

function svgDoc(pieces: Piece[], fill: string, title: string) {
  const box = pieces.reduce<Box>(
    (acc, p) => ({
      x0: Math.min(acc.x0, p.box.x0),
      y0: Math.min(acc.y0, p.box.y0),
      x1: Math.max(acc.x1, p.box.x1),
      y1: Math.max(acc.y1, p.box.y1),
    }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );
  const w = box.x1 - box.x0 + PAD * 2;
  const h = box.y1 - box.y0 + PAD * 2;
  return {
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}" role="img" aria-label="${title}">\n` +
      `  <title>${title}</title>\n` +
      `  <g fill="${fill}" transform="translate(${round(PAD - box.x0)} ${round(PAD - box.y0)})">${pieces.map((p) => p.svg).join("")}</g>\n` +
      `</svg>\n`,
    ratio: w / h,
  };
}

// Cream on dark, ink on light, and the violet for a single-colour use on neutral ground. The
// sunset pairing — cream wordmark, sun-coloured palm — is the banner's and is emitted as its own
// two-tone file rather than a colourway, since it is two fills.
const CREAM = "#f3efe4";
const INK = "#1b1140";
const VIOLET = "#7c5cf6";
const SUN = "#ffd9a8";

const COLOURWAYS = [
  { key: "on-dark", fill: CREAM, note: "cream, for dark backgrounds" },
  { key: "on-light", fill: INK, note: "ink, for light backgrounds" },
  { key: "violet", fill: VIOLET, note: "the accent, for neutral backgrounds" },
] as const;

type Emitted = { path: string; ratio: number };
const emitted: Emitted[] = [];

function write(path: string, body: string) {
  const full = at(path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function emit(dir: string, name: string, pieces: Piece[], fill: string, title: string) {
  const { svg, ratio } = svgDoc(pieces, fill, title);
  const path = `${OUT}/${dir}/${name}.svg`;
  write(path, svg);
  emitted.push({ path, ratio });
}

const word = wordmarkPieces();
const markInWord = markPiece(word.box.x1 + SIZE * MARK_GAP, 0, SIZE * MARK_SIZE);

for (const { key, fill } of COLOURWAYS) {
  emit("mark", `timbre-mark-${key}`, [markPiece(0, 0, MARK_VIEW.h)], fill, "Timbre");
  emit("wordmark", `timbre-wordmark-${key}`, [word], fill, "Timbre");
  emit("lockup", `timbre-lockup-${key}`, [word, markInWord], fill, "Timbre");
}

// currentColor sources — the ones to paste into an app rather than link to.
emit("mark", "timbre-mark", [markPiece(0, 0, MARK_VIEW.h)], "currentColor", "Timbre");
emit("wordmark", "timbre-wordmark", [word], "currentColor", "Timbre");
emit("lockup", "timbre-lockup", [word, markInWord], "currentColor", "Timbre");

// Square tiles, for the slots that want an avatar rather than a logo — a GitHub org, a Discord
// server, a favicon at a size the wordmark would be illegible at. The geometry is lifted from
// apps/web/app/icon.svg so the tiles and the installed app agree: corner radius 105.01/512 of the
// side, and the palm at 0.944113 of the 247x282 viewBox on a 512 tile, centred.
const TILE_RADIUS = 105.01 / 512;
const TILE_MARK = (282 * 0.944113) / 512;

const TILES = [
  { key: "violet", tile: VIOLET, ink: "#0a0a0a", note: "what the installed app uses" },
  { key: "on-dark", tile: INK, ink: CREAM, note: "ink tile, cream palm" },
  { key: "on-light", tile: CREAM, ink: INK, note: "cream tile, ink palm" },
] as const;

for (const { key, tile, ink } of TILES) {
  const side = 512;
  const height = side * TILE_MARK;
  const scale = height / MARK_VIEW.h;
  const x = (side - MARK_VIEW.w * scale) / 2;
  const y = (side - height) / 2;
  write(
    `${OUT}/avatar/timbre-avatar-${key}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}" role="img" aria-label="Timbre">\n` +
      `  <title>Timbre</title>\n` +
      `  <rect width="${side}" height="${side}" rx="${round(side * TILE_RADIUS)}" fill="${tile}"/>\n` +
      `  <path d="${MARK_PATH}" transform="translate(${round(x)} ${round(y)}) scale(${round(scale)})" fill="${ink}"/>\n` +
      `</svg>\n`,
  );
  emitted.push({ path: `${OUT}/avatar/timbre-avatar-${key}.svg`, ratio: 1 });
}

// The banner's own pairing: cream name, sun-coloured palm.
{
  const { svg: a } = svgDoc([word], CREAM, "Timbre");
  const box = { x0: word.box.x0, y0: Math.min(word.box.y0, 0), x1: markInWord.box.x1, y1: Math.max(word.box.y1, markInWord.box.y1) };
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  const body =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}" role="img" aria-label="Timbre">\n` +
    `  <title>Timbre</title>\n` +
    `  <g transform="translate(${round(-box.x0)} ${round(-box.y0)})">` +
    `<g fill="${CREAM}">${word.svg}</g><g fill="${SUN}">${markInWord.svg}</g></g>\n` +
    `</svg>\n`;
  void a;
  write(`${OUT}/lockup/timbre-lockup-sunset.svg`, body);
  emitted.push({ path: `${OUT}/lockup/timbre-lockup-sunset.svg`, ratio: w / h });
}

// ----------------------------------------------------------------------- PNGs

// sharp is not a dependency of this repo — it arrives under node_modules/.pnpm because Next pulls
// it in, so it cannot be `require`d by name and may simply be absent. SVG is the deliverable;
// PNG is a convenience for the places that will not take one.
function findSharp(): ((input: Buffer) => { png: () => { toFile: (p: string) => Promise<unknown> }; resize: (o: unknown) => unknown }) | null {
  const store = at("node_modules/.pnpm");
  if (!existsSync(store)) return null;
  const dirs = readdirSync(store).filter((d) => d.startsWith("sharp@")).sort().reverse();
  const require_ = createRequire(import.meta.url);
  for (const d of dirs) {
    const entry = resolve(store, d, "node_modules/sharp");
    try {
      return require_(entry) as never;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

const PNG_HEIGHTS: Record<string, number[]> = {
  mark: [64, 128, 256, 512, 1024],
  wordmark: [64, 128, 256, 512],
  lockup: [64, 128, 256, 512],
  avatar: [32, 64, 128, 256, 512, 1024],
};

async function rasterise() {
  const sharp = findSharp();
  if (!sharp) {
    console.log("[brand-assets] sharp not found — SVG only, no PNGs written");
    return 0;
  }
  let n = 0;
  for (const { path, ratio } of emitted) {
    const dir = path.split("/").at(-2) ?? "";
    const name = path.split("/").at(-1)?.replace(/\.svg$/, "") ?? "";
    for (const h of PNG_HEIGHTS[dir] ?? []) {
      const w = Math.round(h * ratio);
      const svg = readFileSync(at(path), "utf8").replace(/width="[^"]*" height="[^"]*"/, `width="${w}" height="${h}"`);
      const out = at(`${OUT}/${dir}/png/${name}-${h}.png`);
      mkdirSync(dirname(out), { recursive: true });
      await (sharp(Buffer.from(svg)) as never as { png: () => { toFile: (p: string) => Promise<unknown> } }).png().toFile(out);
      n++;
    }
  }
  return n;
}

// --------------------------------------------------------------------- verify

// The claim this file rests on: the outlined wordmark is the same shape Satori draws. Checked by
// rebuilding the banner's lockup at the banner's own position and comparing masks against the
// shipped PNG — not "looks right", a pixel count.
async function verify() {
  const sharp = findSharp();
  if (!sharp) {
    console.error("[brand-assets] --verify needs sharp, which is not installed");
    return 1;
  }
  const s = sharp as never as (b: Buffer | string) => {
    raw: () => { ensureAlpha: () => { toBuffer: (o: unknown) => Promise<{ data: Buffer; info: { width: number; channels: number } }> }; toBuffer: (o: unknown) => Promise<{ data: Buffer; info: { width: number; channels: number } }> };
  };
  const overlay =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">` +
    `<g fill="#fff" transform="translate(96 96)">${word.svg}</g></svg>`;
  const mine = await s(Buffer.from(overlay)).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const banner = await s(at("docs/brand/banners/readme-banner.png")).raw().toBuffer({ resolveWithObject: true });

  const A = (x: number, y: number) => (mine.data[(y * 1200 + x) * mine.info.channels + 3] ?? 0) > 128;
  const B = (x: number, y: number) => {
    const i = (y * 1200 + x) * banner.info.channels;
    return Math.abs((banner.data[i] ?? 0) - 0xf3) < 30 && Math.abs((banner.data[i + 1] ?? 0) - 0xef) < 30 && Math.abs((banner.data[i + 2] ?? 0) - 0xe4) < 30;
  };

  let inter = 0;
  let union = 0;
  let deep = 0;
  for (let y = 100; y < 230; y++) {
    for (let x = 60; x < 480; x++) {
      const a = A(x, y);
      const b = B(x, y);
      if (a && b) inter++;
      if (a || b) union++;
      if (a === b) continue;
      let nearEdge = false;
      for (let dy = -2; dy <= 2 && !nearEdge; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (A(x + dx, y + dy) !== a || B(x + dx, y + dy) !== b) {
            nearEdge = true;
            break;
          }
        }
      }
      if (!nearEdge) deep++;
    }
  }
  const iou = (inter / union) * 100;
  console.log(`[brand-assets] wordmark vs shipped banner: IoU ${iou.toFixed(2)}%, structural differences ${deep}`);
  if (deep > 0) {
    console.error("[brand-assets] the outlines no longer match the banner — a constant has drifted");
    return 1;
  }
  return 0;
}

const digest = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
void digest;

if (process.argv.includes("--verify")) {
  process.exit(await verify());
}

const pngs = await rasterise();
console.log(`[brand-assets] ${emitted.length} SVG, ${pngs} PNG under ${OUT}`);
console.log(`[brand-assets] run with --verify to check the outlines still match the banner`);
