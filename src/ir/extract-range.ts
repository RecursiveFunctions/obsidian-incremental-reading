/**
 * Locate an extract's text within a parent source body.
 *
 * Pure function — no Obsidian API, no I/O. Layered resolution:
 *   1. Anchor (position hint → text-quote → normalized match)
 *   2. Plain substring fallback for pre-store extracts
 *
 * Returns undefined when the text cannot be located or is ambiguous.
 */

import type { IrElement } from "./model";
import { resolveAnchor } from "./anchor";

export function findExtractRange(
  el: IrElement,
  sourceRaw: string,
): { start: number; end: number } | undefined {
  if (el.anchor) {
    const res = resolveAnchor(el.anchor, sourceRaw);
    if (res.status === "ok") return { start: res.start, end: res.end };
  }
  const text = el.text.trim();
  if (!text) return undefined;
  const idx = sourceRaw.indexOf(text);
  if (idx === -1) return undefined;
  if (sourceRaw.indexOf(text, idx + 1) !== -1) return undefined;
  return { start: idx, end: idx + text.length };
}
