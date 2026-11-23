/** Frontmatter-aware body read/write helpers. Pure string logic, no Obsidian. */

import type { App, TFile } from "obsidian";

export const FRONTMATTER_RE = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

function toLf(s: string): string {
  return s.includes("\r\n") ? s.replace(/\r\n/g, "\n") : s;
}

function lfOffsetAtRawOffset(s: string, rawOffset: number): number {
  const clamped = Math.max(0, Math.min(s.length, rawOffset));
  if (!s.includes("\r\n")) return clamped;
  let lf = 0;
  for (let i = 0; i < clamped; i++) {
    if (s[i] === "\r" && s[i + 1] === "\n") continue;
    lf++;
  }
  return lf;
}

function rawOffsetAtLfOffset(s: string, lfOffset: number): number {
  if (!s.includes("\r\n")) return Math.max(0, Math.min(s.length, lfOffset));
  if (lfOffset <= 0) return 0;
  let lf = 0;
  for (let i = 0; i < s.length; i++) {
    if (lf >= lfOffset) return i;
    if (s[i] === "\r" && s[i + 1] === "\n") continue;
    lf++;
  }
  return s.length;
}

/** Drop the YAML frontmatter block and normalize CRLF -> LF so body offsets match CodeMirror 6 and <textarea>. */
export function stripFrontmatter(content: string): string {
  return toLf(content).replace(FRONTMATTER_RE, "").trim();
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
  const lfFull = toLf(fullFile);
  const lfFrom = lfOffsetAtRawOffset(fullFile, fromOffset);
  const lfTo = lfOffsetAtRawOffset(fullFile, toOffset);
  const fm = lfFull.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = lfFull.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  const trimmedLen = afterFm.trim().length;
  const bodyStartInFull = fmLen + leadingWs;
  const bodyEndInFull = bodyStartInFull + trimmedLen;
  if (lfTo <= bodyStartInFull) return null;
  if (lfFrom >= bodyEndInFull) return null;
  const start = Math.max(0, lfFrom - bodyStartInFull);
  const end = Math.min(trimmedLen, lfTo - bodyStartInFull);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Map a collapsed caret from a full-file offset onto the stripped body.
 * Unlike {@link bodyOffsetsFromFullOffsets}, a caret may sit at the same
 * index as start and end.
 */
export function bodyOffsetFromFullOffset(
  fullFile: string,
  offset: number,
): number {
  const lfFull = toLf(fullFile);
  const lfOff = lfOffsetAtRawOffset(fullFile, offset);
  const fm = lfFull.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = lfFull.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  const trimmedLen = afterFm.trim().length;
  const bodyStartInFull = fmLen + leadingWs;
  return Math.max(0, Math.min(trimmedLen, lfOff - bodyStartInFull));
}

/** Inverse of {@link bodyOffsetsFromFullOffsets}. */
export function fullOffsetsFromBodyOffsets(
  fullFile: string,
  start: number,
  end: number,
): { from: number; to: number } {
  const lfFull = toLf(fullFile);
  const fm = lfFull.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = lfFull.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  const bodyStartInFull = fmLen + leadingWs;
  return {
    from: rawOffsetAtLfOffset(fullFile, bodyStartInFull + start),
    to: rawOffsetAtLfOffset(fullFile, bodyStartInFull + end),
  };
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

function stripLoneSurrogates(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i += 1;
      } else {
        out += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      out += "\ufffd";
    } else {
      out += s[i]!;
    }
  }
  return out;
}

function formatYamlScalar(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(stripLoneSurrogates(value)).replace(
      /[\x7f-\x9f\u2028\u2029\ufffe\uffff]/g,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  }
  return null;
}

function formatYamlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : (formatYamlScalar(key) ?? JSON.stringify(key));
}

/**
 * Serialize a brand-new Markdown note with YAML frontmatter in one pass so bulk
 * importers (`SM`, `EPUB`, `HTML`) can call `vault.create` once without a second
 * `fileManager.processFrontMatter` read-parse-write round-trip.
 */
export function serializeInitialNoteWithFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  markdown: string,
): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!key || value === undefined || value === null) continue;
    const yamlKey = formatYamlKey(key);
    if (Array.isArray(value)) {
      const items = value
        .map((item) => formatYamlScalar(item))
        .filter((s): s is string => s !== null);
      if (items.length === 0) {
        lines.push(`${yamlKey}: []`);
      } else {
        lines.push(`${yamlKey}:`);
        for (const item of items) {
          lines.push(`  - ${item}`);
        }
      }
      continue;
    }
    const scalar = formatYamlScalar(value);
    if (scalar !== null) {
      lines.push(`${yamlKey}: ${scalar}`);
    }
  }
  const cleanBody = markdown.replace(/^\uFEFF/, "").trim();
  if (lines.length === 1) {
    return cleanBody ? `${cleanBody}\n` : "";
  }
  lines.push("---");
  return cleanBody ? `${lines.join("\n")}\n\n${cleanBody}\n` : `${lines.join("\n")}\n`;
}
