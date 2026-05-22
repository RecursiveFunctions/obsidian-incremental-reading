/** Frontmatter-aware body read/write helpers. Pure string logic, no Obsidian. */

import type { App, TFile } from "obsidian";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/** Drop the YAML frontmatter block so only the note body is rendered. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "").trim();
}

/**
 * Selection text copied from a note that still includes YAML (for example
 * after a bad reload) must not become a child note body with a second FM
 * block layered on by `processFrontMatter`.
 */
export function sanitizeExtractSelection(text: string): string {
  return stripFrontmatter(text).trim();
}

const EXTRACT_MARK_OPEN = '<mark class="ir-extract-source">';
const EXTRACT_MARK_CLOSE = "</mark>";

/**
 * Map a selection string to body offsets when the editor shows the full file
 * (YAML + body). Returns null if the selection is missing or ambiguous in the
 * stripped body.
 */
export function selectionOffsetsInBody(
  fullFile: string,
  selection: string,
): { start: number; end: number } | null {
  if (!selection) return null;
  const fm = fullFile.match(FRONTMATTER_RE);
  const body = fm ? fullFile.slice(fm[0].length) : fullFile;
  const idx = body.indexOf(selection);
  if (idx === -1) return null;
  if (body.indexOf(selection, idx + 1) !== -1) return null;
  return { start: idx, end: idx + selection.length };
}

/**
 * Wrap a body span with a visible HTML mark so extracted passages stay
 * visible in the topic/extract in Reading view and in IR review.
 */
function isInsideExtractMark(body: string, start: number, end: number): boolean {
  const open = body.lastIndexOf(EXTRACT_MARK_OPEN, start);
  if (open === -1) return false;
  const close = body.indexOf(EXTRACT_MARK_CLOSE, open);
  return close !== -1 && open < start && end <= close + EXTRACT_MARK_CLOSE.length;
}

export function wrapExtractHighlight(
  body: string,
  start: number,
  end: number,
): string {
  if (end <= start || start < 0 || end > body.length) return body;
  const inner = body.slice(start, end);
  if (!inner.trim()) return body;
  if (isInsideExtractMark(body, start, end)) return body;
  if (
    inner.startsWith(EXTRACT_MARK_OPEN) &&
    inner.endsWith(EXTRACT_MARK_CLOSE)
  ) {
    return body;
  }
  if (
    start >= 2 &&
    body.slice(start - 2, start) === "==" &&
    body.slice(end, end + 2) === "=="
  ) {
    return body;
  }
  return (
    body.slice(0, start) +
    EXTRACT_MARK_OPEN +
    inner +
    EXTRACT_MARK_CLOSE +
    body.slice(end)
  );
}

/**
 * Write a new body back to a note while preserving its existing frontmatter
 * block byte-for-byte. The Obsidian `processFrontMatter` API only lets us
 * mutate frontmatter, not body, so we splice via `vault.modify` instead.
 */
export async function saveBody(app: App, file: TFile, newBody: string): Promise<void> {
  const full = await app.vault.read(file);
  const fm = full.match(FRONTMATTER_RE);
  const prefix = fm ? fm[0] : "";
  await app.vault.modify(file, prefix + newBody.trimEnd() + "\n");
}
