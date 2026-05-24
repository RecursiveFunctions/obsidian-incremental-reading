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
import { stripFrontmatter } from "./frontmatter-body";

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

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Editor coordinates ({ line, ch }, both zero-based) of where an extract
 * begins inside its full source file (frontmatter included). Bridges the
 * body-offset world used by anchors with the line/ch coordinate system that
 * Obsidian's `OpenViewState.eState` consumes, so callers can scroll a freshly
 * opened note straight to the extract instead of dropping the user at the
 * top of the file.
 *
 * Returns undefined when the extract has no locatable text in the file. Pure
 * — no Obsidian API, no I/O — so it stays unit-testable and callable from
 * the view layer without coupling.
 */
export function findExtractEditorPosition(
  el: IrElement,
  fullFileContent: string,
): { line: number; ch: number } | undefined {
  const body = stripFrontmatter(fullFileContent);
  const range = findExtractRange(el, body);
  if (!range) return undefined;
  const fm = fullFileContent.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = fullFileContent.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  const fullOffset = fmLen + leadingWs + range.start;
  let line = 0;
  let ch = 0;
  const cap = Math.min(fullOffset, fullFileContent.length);
  for (let i = 0; i < cap; i++) {
    if (fullFileContent[i] === "\n") {
      line += 1;
      ch = 0;
    } else {
      ch += 1;
    }
  }
  return { line, ch };
}
