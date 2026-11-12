import type { MapNode } from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Tile extends Rect {
  node: MapNode;
  depth: number;
  leaf: boolean;
}

/**
 * Colours for the largest file types. Two tuned sets: lighter, softer ones on
 * the dark theme and deeper ones on the light theme, so tiles read as part of
 * the Fluent UI around them instead of a screen of neon.
 */
const PALETTE_DARK = [
  "#6d8fd0",
  "#cf7a80",
  "#68ae8c",
  "#62aebf",
  "#b08cc2",
  "#c9b068",
  "#cf9a68",
  "#8f88cf",
  "#9db868",
  "#cc8bb0",
  "#5eaea3",
  "#a58b72",
];
const PALETTE_LIGHT = [
  "#5079c2",
  "#c0606a",
  "#4a9874",
  "#3f9bb2",
  "#9a6daa",
  "#b39a45",
  "#c0804a",
  "#7469c0",
  "#7d9d45",
  "#bd6e94",
  "#3f9689",
  "#8a6e56",
];
export const OTHER_EXT_COLOR = "#8b939c";
export const FOLDER_COLOR = "#6b7480";

export function extColors(exts: string[], dark = true): Map<string, string> {
  const palette = dark ? PALETTE_DARK : PALETTE_LIGHT;
  const m = new Map<string, string>();
  exts
    .filter((e) => e !== "")
    .slice(0, palette.length)
    .forEach((e, i) => m.set(e, palette[i]));
  return m;
}

/** Squarified treemap layout (Bruls, Huizing, van Wijk). */
function squarify(sizes: number[], r: Rect): Rect[] {
  const out: Rect[] = new Array(sizes.length);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0 || r.w <= 0 || r.h <= 0) {
    for (let i = 0; i < sizes.length; i++) out[i] = { x: r.x, y: r.y, w: 0, h: 0 };
    return out;
  }
  const scale = (r.w * r.h) / total;
  let { x, y, w, h } = r;
  let i = 0;
  while (i < sizes.length) {
    const side = Math.min(w, h);
    let sum = 0;
    let min = Infinity;
    let max = 0;
    let j = i;
    let best = Infinity;
    while (j < sizes.length) {
      const a = sizes[j] * scale;
      const nsum = sum + a;
      const nmin = Math.min(min, a);
      const nmax = Math.max(max, a);
      const s2 = nsum * nsum;
      const ratio = Math.max((side * side * nmax) / s2, s2 / (side * side * nmin));
      if (ratio > best && j > i) break;
      best = ratio;
      sum = nsum;
      min = nmin;
      max = nmax;
      j++;
    }
    // Lay out sizes[i..j) as one row along the shorter side.
    const thick = side > 0 ? sum / side : 0;
    let off = 0;
    for (let k = i; k < j; k++) {
      const len = sum > 0 ? ((sizes[k] * scale) / sum) * side : 0;
      out[k] = w >= h ? { x, y: y + off, w: thick, h: len } : { x: x + off, y, w: len, h: thick };
      off += len;
    }
    if (w >= h) {
      x += thick;
      w -= thick;
    } else {
      y += thick;
      h -= thick;
    }
    i = j;
  }
  return out;
}

/** All tiles, parents before their children. */
export function layout(root: MapNode, r: Rect): Tile[] {
  const tiles: Tile[] = [];
  const visit = (n: MapNode, rect: Rect, depth: number) => {
    const kids = n.c ?? [];
    tiles.push({ ...rect, node: n, depth, leaf: kids.length === 0 });
    if (!kids.length || rect.w < 2 || rect.h < 2) return;
    const sizes = kids.map((c) => c.s);
    const used = sizes.reduce((a, b) => a + b, 0);
    // Space of children too small to be sent stays as the folder's own color.
    if (n.s > used) sizes.push(n.s - used);
    const rects = squarify(sizes, rect);
    kids.forEach((c, i) => {
      if (rects[i].w >= 1 && rects[i].h >= 1) visit(c, rects[i], depth + 1);
    });
  };
  visit(root, r, 0);
  return tiles;
}

export interface DrawOpts {
  colors: Map<string, string>;
  selected: number | null;
  highlightExt: string | null;
  dark: boolean;
  /** Formats a byte count for the labels; without it only names are drawn. */
  format?: (bytes: number) => string;
}

const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';

function tileColor(t: Tile, colors: Map<string, string>): string {
  const n = t.node;
  if (n.k === 1) return colors.get(n.e) ?? OTHER_EXT_COLOR;
  if (n.k === 2) return OTHER_EXT_COLOR;
  return FOLDER_COLOR;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const r = Math.max(0, Math.min(3, w / 4, h / 4));
  ctx.beginPath();
  if (r < 1) ctx.rect(x, y, w, h);
  else ctx.roundRect(x, y, w, h, r);
}

/** Shortens text with an ellipsis until it fits. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + "…" : "";
}

export function draw(ctx: CanvasRenderingContext2D, tiles: Tile[], opts: DrawOpts) {
  const { colors, selected, highlightExt, dark, format } = opts;
  const GAP = 0.75; // half of the gap between neighbouring tiles

  // 1. Tiles: flat colour, a soft light-to-shade wash and a fine top highlight.
  for (const t of tiles) {
    const n = t.node;
    if (!t.leaf && n.k === 0) {
      // Folder background shows through where small items were dropped.
      ctx.fillStyle = FOLDER_COLOR;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      continue;
    }
    const x = t.x + GAP;
    const y = t.y + GAP;
    const w = t.w - GAP * 2;
    const h = t.h - GAP * 2;
    if (w <= 0 || h <= 0) continue;

    const dim = highlightExt !== null && !(n.k === 1 && n.e === highlightExt);
    ctx.globalAlpha = dim ? 0.16 : 1;
    ctx.fillStyle = tileColor(t, colors);
    roundedRect(ctx, x, y, w, h);
    ctx.fill();
    if (w > 4 && h > 4) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "rgba(255,255,255,0.07)");
      g.addColorStop(1, "rgba(0,0,0,0.10)");
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // 2. Gutters between folders: cut transparent lines so the surface shows
  //    through. The nesting level decides the width, which gives the map its
  //    structure without any dark outlines.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = "#000";
  for (const t of tiles) {
    if (t.node.k !== 0 || t.w < 6 || t.h < 6) continue;
    if (t.depth === 1) ctx.lineWidth = 4;
    else if (t.depth === 2) ctx.lineWidth = 2.5;
    else continue;
    ctx.strokeRect(t.x, t.y, t.w, t.h);
  }
  ctx.restore();

  // 3. Labels on tiles big enough to read.
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.38)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  for (const t of tiles) {
    const n = t.node;
    if (n.k !== 1 || t.w < 68 || t.h < 24) continue;
    if (highlightExt !== null && n.e !== highlightExt) continue;
    const pad = 7;
    const room = t.w - pad * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(t.x + 2, t.y + 2, t.w - 4, t.h - 4);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = `600 12px ${FONT}`;
    const name = fit(ctx, n.n, room);
    if (name) ctx.fillText(name, t.x + pad, t.y + 6);
    if (format && t.h >= 42) {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `400 11px ${FONT}`;
      ctx.fillText(format(n.s), t.x + pad, t.y + 22);
    }
    ctx.restore();
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 4. Selection: a bright ring with a dark halo so it shows on any colour.
  if (selected !== null) {
    const s = tiles.find((t) => t.node.id === selected);
    if (s && s.depth > 0 && s.w > 3 && s.h > 3) {
      const x = s.x + GAP;
      const y = s.y + GAP;
      const w = s.w - GAP * 2;
      const h = s.h - GAP * 2;
      ctx.lineWidth = 4;
      ctx.strokeStyle = dark ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.35)";
      roundedRect(ctx, x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fff";
      roundedRect(ctx, x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      ctx.stroke();
    }
  }
}

/** Deepest tile under the point. */
export function hitTest(tiles: Tile[], x: number, y: number): Tile | null {
  let hit: Tile | null = null;
  for (const t of tiles) {
    if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) hit = t;
  }
  return hit;
}
