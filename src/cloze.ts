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
