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

/**
 * Tags written by pre-§Q3 builds. New extracts no longer mutate the source
 * (decoration-only highlights), but legacy notes still carry these and
 * {@link stripExtractMarks} reads them when surfacing display text from the
 * stored `quote.exact`.
 */
export const EXTRACT_MARK_OPEN = '<mark class="ir-extract-source">';
export const EXTRACT_MARK_CLOSE = "</mark>";

/**
 * Map a selection range from full-file offsets (as produced by
 * `editor.posToOffset`) onto body offsets that match what `stripFrontmatter`
 * returns (frontmatter stripped, body trimmed). Returns null only when the
 * selection lies entirely inside the frontmatter or the surrounding
 * whitespace — i.e., when there is no body text to anchor against.
 */
export function bodyOffsetsFromFullOffsets(
  fullFile: string,
  fromOffset: number,
  toOffset: number,
): { start: number; end: number } | null {
  if (toOffset <= fromOffset) return null;
  const fm = fullFile.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = fullFile.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  const trimmedLen = afterFm.trim().length;
  const bodyStartInFull = fmLen + leadingWs;
  const bodyEndInFull = bodyStartInFull + trimmedLen;
  if (toOffset <= bodyStartInFull) return null;
  if (fromOffset >= bodyEndInFull) return null;
  const start = Math.max(0, fromOffset - bodyStartInFull);
  const end = Math.min(trimmedLen, toOffset - bodyStartInFull);
  if (end <= start) return null;
  return { start, end };
}

/** Inverse of {@link bodyOffsetsFromFullOffsets}. */
export function fullOffsetsFromBodyOffsets(
  fullFile: string,
  start: number,
  end: number,
): { from: number; to: number } {
  const fm = fullFile.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = fullFile.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  const bodyStartInFull = fmLen + leadingWs;
  return { from: bodyStartInFull + start, to: bodyStartInFull + end };
}

/**
 * Strip pre-§Q3 `<mark class="ir-extract-source">...</mark>` chrome, leaving
 * only the visible text. Iteratively removes pairs from the inside out so it
 * handles nested marks (an extract that itself contains a sibling extract
 * span). Used when rendering display text from a legacy stored extract so the
 * literal HTML never leaks into the UI as escaped text.
 */
const IR_OPEN_TAG_RE = /^<mark\s+class="ir-extract-source">/i;
const ANY_OPEN_TAG_RE = /^<mark\b[^>]*>/i;
const CLOSE_TAG_RE = /^<\/mark\s*>/i;

/**
 * Single-pass walker that removes IR's `<mark class="ir-extract-source">`
 * chrome (including orphans from selections that started or ended mid-mark)
 * while leaving any user-authored `<mark>…</mark>` pair intact.
 *
 * The stack records the kind of each open tag (IR vs. anything else): an
 * IR opener emits nothing and its matching closer drops; any other opener
 * is emitted verbatim and its matching closer comes through. Closers with
 * no opener on the stack are orphans and dropped.
 */
export function stripExtractMarks(s: string): string {
  if (!s.includes(EXTRACT_MARK_OPEN) && !s.toLowerCase().includes("</mark>")) {
    return s;
  }
  let out = "";
  let i = 0;
  const stack: ("ir" | "other")[] = [];
  while (i < s.length) {
    if (s[i] === "<") {
      const tail = s.slice(i);
      const irOpen = tail.match(IR_OPEN_TAG_RE);
      if (irOpen) {
        stack.push("ir");
        i += irOpen[0].length;
        continue;
      }
      const otherOpen = tail.match(ANY_OPEN_TAG_RE);
      if (otherOpen) {
        stack.push("other");
        out += otherOpen[0];
        i += otherOpen[0].length;
        continue;
      }
      const close = tail.match(CLOSE_TAG_RE);
      if (close) {
        if (stack.length === 0) {
          // Orphan closer — drop.
          i += close[0].length;
          continue;
        }
        const top = stack.pop()!;
        if (top === "other") out += close[0];
        // IR closer: drop.
        i += close[0].length;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
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
