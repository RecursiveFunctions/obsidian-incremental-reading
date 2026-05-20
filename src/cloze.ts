/**
 * Cloze deletion format.
 *
 * One Anki-compatible syntax, defined in exactly one place so the writer
 * (extract/cloze creation) and the future reader (Review UI) cannot drift:
 *
 *     {{c1::hidden answer}}
 *
 * The numbered group supports multiple deletions per note later without a
 * format change.
 */

/** Wrap `answer` as cloze group `n` (defaults to 1). */
export function wrapCloze(answer: string, n = 1): string {
  return `{{c${n}::${answer}}}`;
}

/** Global matcher for cloze spans; capture group 1 is the hidden answer. */
export const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)\}\}/g;

/** True if `text` contains at least one cloze deletion. */
export function hasCloze(text: string): boolean {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text);
}

/**
 * Next free cloze group number for `text`: max existing `cN` plus one,
 * or 1 if there are none. Used when splicing another deletion into a note
 * that already has clozes (Anki multi-cloze semantics: each unique N
 * generates one card on import).
 */
export function nextClozeNumber(text: string): number {
  CLOZE_RE.lastIndex = 0;
  let max = 0;
  let m: RegExpExecArray | null;
  while ((m = CLOZE_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

export interface ClozeBuild {
  /** The lines, with the selected span wrapped as a cloze deletion. */
  body: string;
  /** The exact selected text that became the hidden answer. */
  answer: string;
}

/**
 * Pure core of cloze creation, kept free of the Obsidian API so it can be
 * unit tested directly. `spannedLines` are the full editor lines the
 * selection touches (index 0 is the line of `fromCh`, the last is the line
 * of `toCh`). The selection is located by offset inside the joined block so
 * the splice is exact even when the same words appear elsewhere on the line.
 */
export function buildClozeBody(
  spannedLines: string[],
  fromCh: number,
  toCh: number,
): ClozeBuild {
  const block = spannedLines.join("\n");
  const last = spannedLines[spannedLines.length - 1] ?? "";
  const start = fromCh;
  const end =
    spannedLines.length === 1 ? toCh : block.length - last.length + toCh;
  const answer = block.slice(start, end);
  const body = block.slice(0, start) + wrapCloze(answer) + block.slice(end);
  return { body, answer };
}

/**
 * Same as `buildClozeBody` but starting from a flat raw string plus absolute
 * character offsets into it (e.g., a textarea's `selectionStart`/`selectionEnd`
 * or an `indexOf` hit). Locates the spanned lines and per-line columns, then
 * delegates to `buildClozeBody` so the splicing logic stays in one place.
 */
export function buildClozeFromText(
  raw: string,
  selStart: number,
  selEnd: number,
): ClozeBuild {
  const lines = raw.split("\n");
  let acc = 0;
  let startLine = -1;
  let fromCh = 0;
  let endLine = -1;
  let toCh = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineEnd = acc + lines[i].length;
    if (startLine === -1 && selStart <= lineEnd) {
      startLine = i;
      fromCh = selStart - acc;
    }
    if (endLine === -1 && selEnd <= lineEnd) {
      endLine = i;
      toCh = selEnd - acc;
    }
    acc = lineEnd + 1; // +1 for the newline separator
  }
  if (startLine === -1) {
    startLine = lines.length - 1;
    fromCh = lines[startLine]?.length ?? 0;
  }
  if (endLine === -1) {
    endLine = lines.length - 1;
    toCh = lines[endLine]?.length ?? 0;
  }
  return buildClozeBody(lines.slice(startLine, endLine + 1), fromCh, toCh);
}
