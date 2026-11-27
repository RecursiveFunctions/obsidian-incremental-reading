/**
 * Image occlusion format (rectangles + SuperMemo `THitEditor` polygons).
 *
 * Coordinates are normalized (0..1) against the image's natural size so the
 * same block renders correctly at any display width.
 */

import type { NormalizedRect } from "./model";

export type OcclusionMode = "hide-all" | "hide-one";

export interface OcclusionRect extends NormalizedRect {
  /** 1-based, stable across the sibling cards built from one editor session. */
  n: number;
  /** Optional caption shown on reveal (and as the hint while hidden). */
  label?: string;
}

export interface OcclusionPolygon {
  /** 1-based region index, sharing the `n` namespace with `rects`. */
  n: number;
  /** Normalized `[x, y]` vertices (`>= 3` points, each in `0..1`). */
  points: Array<[number, number]>;
  /** Optional caption shown on reveal (and as hint while hidden). */
  label?: string;
}

export interface OcclusionSpec {
  /** Vault path (or link text) of the image. */
  image: string;
  mode: OcclusionMode;
  /** `n` of the rect or polygon this card tests. */
  active: number;
  rects: OcclusionRect[];
  polygons?: OcclusionPolygon[];
}

export const OCCLUSION_LANG = "ir-occlusion";

/** Matches the whole fenced block; group 1 is the JSON payload. */
export const OCCLUSION_BLOCK_RE =
  /```ir-occlusion[ \t]*\n([\s\S]*?)\n```/;

export function hasOcclusion(text: string): boolean {
  return OCCLUSION_BLOCK_RE.test(text);
}

function clamp01(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

/** Ray-casting point-in-polygon hit test (`THitEditor` parity). */
export function pointInPolygon(
  point: readonly [number, number],
  vertices: ReadonlyArray<readonly [number, number]>,
): boolean {
  if (vertices.length < 3) return false;
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i]!;
    const [xj, yj] = vertices[j]!;
    const intersects =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-15) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Parse the JSON payload of one block. Null on any structural problem. */
export function parseOcclusionJson(json: string): OcclusionSpec | null {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  if (typeof o.image !== "string" || !o.image.trim()) return null;
  const mode: OcclusionMode = o.mode === "hide-one" ? "hide-one" : "hide-all";
  const rects: OcclusionRect[] = [];
  if (Array.isArray(o.rects)) {
    for (const r of o.rects) {
      if (!r || typeof r !== "object") continue;
      const rr = r as Record<string, unknown>;
      const x = clamp01(rr.x);
      const y = clamp01(rr.y);
      const w = clamp01(rr.w);
      const h = clamp01(rr.h);
      const n = typeof rr.n === "number" ? Math.floor(rr.n) : NaN;
      if (x === null || y === null || w === null || h === null) continue;
      if (!Number.isFinite(n) || n < 1) continue;
      const rect: OcclusionRect = { n, x, y, w, h };
      if (typeof rr.label === "string" && rr.label.trim()) {
        rect.label = rr.label.trim();
      }
      rects.push(rect);
    }
  }

  const polygons: OcclusionPolygon[] = [];
  if (Array.isArray(o.polygons)) {
    for (const p of o.polygons) {
      if (!p || typeof p !== "object") continue;
      const pp = p as Record<string, unknown>;
      const n = typeof pp.n === "number" ? Math.floor(pp.n) : NaN;
      if (!Number.isFinite(n) || n < 1 || !Array.isArray(pp.points)) continue;
      const pts: Array<[number, number]> = [];
      for (const pt of pp.points) {
        if (!Array.isArray(pt) || pt.length < 2) continue;
        const px = clamp01(pt[0]);
        const py = clamp01(pt[1]);
        if (px !== null && py !== null) pts.push([px, py]);
      }
      if (pts.length < 3) continue;
      const poly: OcclusionPolygon = { n, points: pts };
      if (typeof pp.label === "string" && pp.label.trim()) {
        poly.label = pp.label.trim();
      }
      polygons.push(poly);
    }
  }

  if (rects.length === 0 && polygons.length === 0) return null;
  const allNs = [...rects.map((r) => r.n), ...polygons.map((p) => p.n)];
  const active =
    typeof o.active === "number" && allNs.includes(o.active)
      ? o.active
      : allNs[0]!;
  return {
    image: o.image.trim(),
    mode,
    active,
    rects,
    ...(polygons.length > 0 ? { polygons } : {}),
  };
}

/** First `ir-occlusion` block in a note body, parsed. */
export function parseOcclusionBlock(body: string): OcclusionSpec | null {
  const m = OCCLUSION_BLOCK_RE.exec(body);
  if (!m) return null;
  return parseOcclusionJson(m[1] ?? "");
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/** Canonical JSON for a spec: stable key order, 4-decimal coordinates. */
export function serializeOcclusionJson(spec: OcclusionSpec): string {
  const rects = spec.rects.map((r) => {
    const out: Record<string, unknown> = {
      n: r.n,
      x: round4(r.x),
      y: round4(r.y),
      w: round4(r.w),
      h: round4(r.h),
    };
    if (r.label) out.label = r.label;
    return out;
  });
  const polygons =
    spec.polygons && spec.polygons.length > 0
      ? spec.polygons.map((p) => {
          const out: Record<string, unknown> = {
            n: p.n,
            points: p.points.map(([x, y]) => [round4(x), round4(y)]),
          };
          if (p.label) out.label = p.label;
          return out;
        })
      : undefined;
  return JSON.stringify({
    image: spec.image,
    mode: spec.mode,
    active: spec.active,
    rects,
    ...(polygons ? { polygons } : {}),
  });
}

/** The fenced block, ready to be a note body. */
export function serializeOcclusionBlock(spec: OcclusionSpec): string {
  return "```" + OCCLUSION_LANG + "\n" + serializeOcclusionJson(spec) + "\n```";
}

/**
 * Bodies for one item note per rect/polygon.
 */
export function occlusionBodies(
  base: Omit<OcclusionSpec, "active">,
): Array<{ n: number; body: string; label?: string }> {
  const targets: Array<{ n: number; label?: string }> = [
    ...base.rects.map((r) => ({ n: r.n, label: r.label })),
    ...(base.polygons ?? []).map((p) => ({ n: p.n, label: p.label })),
  ];
  return targets.map((t) => ({
    n: t.n,
    label: t.label,
    body: serializeOcclusionBlock({ ...base, active: t.n }),
  }));
}

export function maskPlan(
  spec: OcclusionSpec,
  revealed: boolean,
): Array<{ rect: OcclusionRect; masked: boolean; active: boolean }> {
  return spec.rects.map((rect) => {
    const active = rect.n === spec.active;
    const masked = active ? !revealed : spec.mode === "hide-all";
    return { rect, masked, active };
  });
}

export function polygonMaskPlan(
  spec: OcclusionSpec,
  revealed: boolean,
): Array<{ polygon: OcclusionPolygon; masked: boolean; active: boolean }> {
  return (spec.polygons ?? []).map((polygon) => {
    const active = polygon.n === spec.active;
    const masked = active ? !revealed : spec.mode === "hide-all";
    return { polygon, masked, active };
  });
}

export function occlusionNoteStem(imagePath: string, n: number): string {
  const base = imagePath.split("/").pop() ?? imagePath;
  const stem = base.replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, "");
  return `Occlusion ${stem || "image"} ${n}`;
}

export function normalizeDragRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minSize = 0.01,
): NormalizedRect | null {
  const x1 = Math.min(1, Math.max(0, Math.min(ax, bx)));
  const y1 = Math.min(1, Math.max(0, Math.min(ay, by)));
  const x2 = Math.min(1, Math.max(0, Math.max(ax, bx)));
  const y2 = Math.min(1, Math.max(0, Math.max(ay, by)));
  const w = x2 - x1;
  const h = y2 - y1;
  if (w < minSize || h < minSize) return null;
  return { x: x1, y: y1, w, h };
}

export function nextRectNumber(
  rects: ReadonlyArray<OcclusionRect>,
  polygons: ReadonlyArray<OcclusionPolygon> = [],
): number {
  let max = 0;
  for (const r of rects) if (r.n > max) max = r.n;
  for (const p of polygons) if (p.n > max) max = p.n;
  return max + 1;
}
