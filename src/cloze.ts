/**
 * Cloze deletion format.
 *
 * Anki-compatible syntax, defined in exactly one place so the writer
 * (extract/cloze creation) and the future reader (Review UI) cannot drift:
 *
 *     {{c1::hidden answer}}
 *     {{c1::hidden answer::optional hint}}   // hint shown while hidden (SM-style)
 *
 * When a hint is present, everything before the **last** `::` inside the tag
 * is the hidden answer (so answers may contain `::`). The hint must not
 * contain `::` (validated in the creation modal).
 *
 * The numbered group supports multiple deletions per note later without a
 * format change.
 */

/** Escape minimal HTML entities for safe injection into `<mark>` bodies. */
export function escapeClozeHtmlFragment(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Split the inside of `{{cN::<inner>}}`: last `::` separates optional hint
 * (Anki / SuperMemo-style).
 */
export function parseClozeInner(inner: string): {
  answer: string;
  hint?: string;
} {
  const parts = inner.split("::");
  if (parts.length < 2) return { answer: inner };
  const rawHint = parts[parts.length - 1] ?? "";
  const hint = rawHint.trim();
  const answer = parts.slice(0, -1).join("::");
  if (!hint) return { answer };
  return { answer, hint };
}

/** Wrap `answer` as cloze group `n` (defaults to 1), with optional `hint`. */
export function wrapCloze(answer: string, n = 1, hint?: string): string {
  const h = hint?.trim();
  if (h) {
    if (h.includes("::")) {
      console.warn(
        "Incremental Reading: cloze hint contains illegal `::`; hint dropped.",
      );
      return `{{c${n}::${answer}}}`;
    }
    return `{{c${n}::${answer}::${h}}}`;
  }
  return `{{c${n}::${answer}}}`;
}

/** Global matcher for cloze spans; capture group 2 is the full inner payload. */
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

/**
 * Replace the hint of the `n`-th cloze group inside `body` with `hint`. Pass
 * `null` (or an empty string) to drop the hint entirely, leaving a bare
 * `{{cN::answer}}`. The answer text is preserved verbatim — only the hint
 * portion (text after the last `::` inside the span) changes.
 *
 * If `n` is not present in `body`, returns the body unchanged. Throws when
 * `hint` contains the reserved `::` separator (which would silently bleed
 * into the answer at parse time and corrupt the card).
 *
 * Pure: no Obsidian imports, so the same helper can be called from the tree
 * context menu, the review pane, and unit tests.
 */
export function setClozeHint(
  body: string,
  n: number,
  hint: string | null,
): string {
  const trimmed = hint?.trim() ?? "";
  if (trimmed.includes("::")) {
    throw new Error('cloze hint cannot contain "::"');
  }
  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out += body.slice(last, start);
    const matchN = Number(m[1]);
    if (matchN === n) {
      const parsed = parseClozeInner(m[2] ?? "");
      out += wrapCloze(parsed.answer, matchN, trimmed || undefined);
    } else {
      out += m[0];
    }
    last = end;
  }
  out += body.slice(last);
  return out;
}

/**
 * Enumerate every cloze span in `body` with its group number, answer text,
 * and current hint (if any). Used by the tree-view edit-hint UI to populate
 * one labeled input per group; callers iterate the array and call
 * `setClozeHint` for each group whose hint changed.
 */
export interface ClozeGroupInfo {
  n: number;
  answer: string;
  hint?: string;
}

export function listClozeGroups(body: string): ClozeGroupInfo[] {
  const out: ClozeGroupInfo[] = [];
  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const parsed = parseClozeInner(m[2] ?? "");
    const info: ClozeGroupInfo = { n, answer: parsed.answer };
    if (parsed.hint !== undefined) info.hint = parsed.hint;
    out.push(info);
  }
  return out;
}

/** Distinct `cN` group numbers present in `text`, sorted ascending. */
export function listClozeGroupNumbers(text: string): number[] {
  const seen = new Set<number>();
  CLOZE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLOZE_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Build a note body where cloze group `focusN` stays hidden as `{{c1::…}}`
 * (optional hint preserved); every other cloze is replaced with its plain
 * answer text so the card has a single active blank.
 */
export function bodyWithSingleClozeGroup(
  fullBody: string,
  focusN: number,
): string {
  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullBody)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    out += fullBody.slice(last, start);
    const n = Number(m[1]);
    const inner = m[2] ?? "";
    const parsed = parseClozeInner(inner);
    if (n === focusN) {
      out += wrapCloze(parsed.answer, 1, parsed.hint);
    } else {
      out += parsed.answer;
    }
    last = end;
  }
  out += fullBody.slice(last);
  return out;
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
  hint?: string,
  groupN = 1,
): ClozeBuild {
  const block = spannedLines.join("\n");
  const last = spannedLines[spannedLines.length - 1] ?? "";
  const start = fromCh;
  const end =
    spannedLines.length === 1 ? toCh : block.length - last.length + toCh;
  const answer = block.slice(start, end);
  const body =
    block.slice(0, start) + wrapCloze(answer, groupN, hint) + block.slice(end);
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
  hint?: string,
  groupN = 1,
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
  return buildClozeBody(
    lines.slice(startLine, endLine + 1),
    fromCh,
    toCh,
    hint,
    groupN,
  );
}

/**
 * Splice a cloze deletion into `raw` at `[selStart, selEnd)`, preserving the
 * lines before/after the spanned region. Use this when the existing note
 * should grow into a multi-cloze (Anki-style): the caller picks `groupN`
 * (typically {@link nextClozeNumber}(raw)) so each blank stays a distinct
 * card.
 */
export function spliceClozeIntoText(
  raw: string,
  selStart: number,
  selEnd: number,
  hint?: string,
  groupN = 1,
): ClozeBuild {
  if (selEnd <= selStart) return { body: raw, answer: "" };
  const answer = raw.slice(selStart, selEnd);
  const body =
    raw.slice(0, selStart) + wrapCloze(answer, groupN, hint) + raw.slice(selEnd);
  return { body, answer };
}

/**
 * Replace every `{{cN::answer}}` (and `{{cN::answer::hint}}`) span with a
 * neutral `marker` so the surrounding context can be shown in
 * spoiler-sensitive UIs — like the IR element tree while a review pane is
 * open — without leaking the hidden answer. Length is fixed (default four
 * underscores) so the marker doesn't telegraph the answer's character count.
 *
 * Pure: no Obsidian imports. Composes `transformClozes` so backtick-wrapped
 * inline-code clozes are also collapsed cleanly (the surrounding backticks
 * are consumed) — without that, redacting a body like `` `{{c1::x}}` `` would
 * leave dangling backticks in the label.
 */
export function redactClozeAnswers(text: string, marker = "____"): string {
  return transformClozes(text, () => marker);
}

/**
 * Walk `raw` and rewrite each `{{cN::…}}` marker to whatever HTML `build`
 * returns. When a marker is immediately surrounded by a single backtick on
 * each side (i.e. the marker is the body of an inline-code span), the
 * backticks are consumed and `build` is told `inCodeSpan = true` so the
 * caller can wrap its replacement in `<code>…</code>`.
 *
 * Why: Obsidian's markdown renderer escapes HTML that sits inside an inline
 * code span, so `\`{{c1::…}}\`` → `\`<mark>…</mark>\`` ends up displayed as
 * literal HTML text. Consuming the backticks at substitution time avoids the
 * code-span context entirely while still preserving monospaced styling via
 * an explicit `<code>` wrapper.
 *
 * Pure: no Obsidian imports, so it's testable in isolation.
 */
export function transformClozes(
  raw: string,
  build: (
    parsed: { answer: string; hint?: string },
    inCodeSpan: boolean,
  ) => string,
): string {
  const re = /\{\{c(\d+)::([\s\S]*?)\}\}/g;
  let out = "";
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    const inCodeSpan =
      start > 0 &&
      raw[start - 1] === "`" &&
      end < raw.length &&
      raw[end] === "`";
    const sliceStart = inCodeSpan ? start - 1 : start;
    const sliceEnd = inCodeSpan ? end + 1 : end;
    out += raw.slice(lastEnd, sliceStart);
    out += build(parseClozeInner(m[2]), inCodeSpan);
    lastEnd = sliceEnd;
  }
  out += raw.slice(lastEnd);
  return out;
}
