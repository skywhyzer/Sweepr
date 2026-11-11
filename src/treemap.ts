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

/** Colors for the largest file types, WinDirStat style. */
const PALETTE = [
  "#3d6ff2",
  "#e5484d",
  "#30a46c",
  "#12a5c9",
  "#c547c5",
  "#e6b422",
  "#f2771c",
  "#7c5cf5",
  "#86b51e",
  "#e85c9a",
  "#1f9d8b",
  "#a87447",
];
export const OTHER_EXT_COLOR = "#8b939c";
export const FOLDER_COLOR = "#6b7480";

export function extColors(exts: string[]): Map<string, string> {
  const m = new Map<string, string>();
  exts
    .filter((e) => e !== "")
    .slice(0, PALETTE.length)
    .forEach((e, i) => m.set(e, PALETTE[i]));
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
}

function tileColor(t: Tile, colors: Map<string, string>): string {
  const n = t.node;
  if (n.k === 1) return colors.get(n.e) ?? OTHER_EXT_COLOR;
  if (n.k === 2) return OTHER_EXT_COLOR;
  return FOLDER_COLOR;
}

export function draw(ctx: CanvasRenderingContext2D, tiles: Tile[], opts: DrawOpts) {
  const { colors, selected, highlightExt, dark } = opts;
  for (const t of tiles) {
    const n = t.node;
    if (!t.leaf && n.k === 0) {
      // Folder background shows through where small items were dropped.
      ctx.fillStyle = FOLDER_COLOR;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      continue;
    }
    const color = tileColor(t, colors);
    const dim = highlightExt !== null && !(n.k === 1 && n.e === highlightExt);
    ctx.globalAlpha = dim ? 0.18 : 1;
    ctx.fillStyle = color;
    ctx.fillRect(t.x, t.y, t.w, t.h);
    if (t.w > 3 && t.h > 3) {
      // Cushion shading: light top-left, darker bottom-right.
      const g = ctx.createLinearGradient(t.x, t.y, t.x + t.w, t.y + t.h);
      g.addColorStop(0, "rgba(255,255,255,0.38)");
      g.addColorStop(0.5, "rgba(255,255,255,0)");
      g.addColorStop(1, "rgba(0,0,0,0.32)");
      ctx.fillStyle = g;
      ctx.fillRect(t.x, t.y, t.w, t.h);
    }
    ctx.globalAlpha = 1;
  }
  // Thin separators between top-level folders give the map structure.
  ctx.lineWidth = 1;
  ctx.strokeStyle = dark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)";
  for (const t of tiles) {
    if (t.depth >= 1 && t.depth <= 2 && t.w > 4 && t.h > 4) {
      ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
    }
  }
  if (selected !== null) {
    const s = tiles.find((t) => t.node.id === selected);
    if (s) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#000";
      ctx.strokeRect(s.x + 1.5, s.y + 1.5, Math.max(0, s.w - 3), Math.max(0, s.h - 3));
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(s.x + 1.5, s.y + 1.5, Math.max(0, s.w - 3), Math.max(0, s.h - 3));
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
