/**
 * Image occlusion format.
 *
 * An occlusion item is a normal IR item note whose body holds one fenced
 * code block in the `ir-occlusion` language. The block is JSON, defined in
 * exactly one place (here) so the editor that writes it, the code-block
 * processor that renders it, and the review pane that reveals it cannot
 * drift:
 *
 *     ```ir-occlusion
 *     {"image":"attachments/heart.png","mode":"hide-all","active":2,
 *      "rects":[{"n":1,"x":0.1,"y":0.2,"w":0.3,"h":0.1,"label":"aorta"}, ...]}
 *     ```
 *
 * Coordinates are normalized (0..1) against the image's natural size so the
 * same block renders correctly at any display width. `active` names the
 * rect this card tests; `mode` decides whether the other rects stay masked
 * ("hide-all", Anki's "hide all, guess one") or are shown as context
 * ("hide-one").
 *
 * One item note per rect, so each occlusion is its own scheduled card, the
 * same 1:1 note-to-card rule the text clozes follow.
 */

import type { NormalizedRect } from "./model";

export type OcclusionMode = "hide-all" | "hide-one";

export interface OcclusionRect extends NormalizedRect {
  /** 1-based, stable across the sibling cards built from one editor session. */
  n: number;
  /** Optional caption shown on reveal (and as the hint while hidden). */
  label?: string;
}

export interface OcclusionSpec {
  /** Vault path (or link text) of the image. */
  image: string;
  mode: OcclusionMode;
  /** `n` of the rect this card tests. */
  active: number;
  rects: OcclusionRect[];
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
  if (!Array.isArray(o.rects)) return null;
  const rects: OcclusionRect[] = [];
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
  if (rects.length === 0) return null;
  const active =
    typeof o.active === "number" && rects.some((r) => r.n === o.active)
      ? o.active
      : rects[0]!.n;
  return { image: o.image.trim(), mode, active, rects };
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
  return JSON.stringify({
    image: spec.image,
    mode: spec.mode,
    active: spec.active,
    rects,
  });
}

/** The fenced block, ready to be a note body. */
export function serializeOcclusionBlock(spec: OcclusionSpec): string {
  return "```" + OCCLUSION_LANG + "\n" + serializeOcclusionJson(spec) + "\n```";
}

/**
 * Bodies for one item note per rect. Each body is the same spec with a
 * different `active`, so siblings share the image and every mask position.
 */
export function occlusionBodies(
  base: Omit<OcclusionSpec, "active">,
): Array<{ n: number; body: string; label?: string }> {
  return base.rects.map((r) => ({
    n: r.n,
    label: r.label,
    body: serializeOcclusionBlock({ ...base, active: r.n }),
  }));
}

/**
 * Which rects are masked for a card in a given reveal state. Pure so the
 * renderer and tests agree: hidden = drawn as an opaque mask; the active
 * rect is additionally flagged so CSS can style it as "the blank".
 */
export function maskPlan(
  spec: OcclusionSpec,
  revealed: boolean,
): Array<{ rect: OcclusionRect; masked: boolean; active: boolean }> {
  return spec.rects.map((rect) => {
    const active = rect.n === spec.active;
    let masked: boolean;
    if (active) masked = !revealed;
    else masked = spec.mode === "hide-all";
    return { rect, masked, active };
  });
}

/** Non-spoiling note name for the k-th occlusion card of an image. */
export function occlusionNoteStem(imagePath: string, n: number): string {
  const base = imagePath.split("/").pop() ?? imagePath;
  const stem = base.replace(/\.[a-z0-9]+$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, "");
  return `Occlusion ${stem || "image"} ${n}`;
}

/**
 * Clamp a dragged rectangle into the unit square and normalize a
 * "dragged up-left" rect to positive width/height. Rejects slivers so a
 * stray click never produces an invisible card.
 */
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

/** Next free `n` for a new rect. */
export function nextRectNumber(rects: ReadonlyArray<OcclusionRect>): number {
  let max = 0;
  for (const r of rects) if (r.n > max) max = r.n;
  return max + 1;
}
