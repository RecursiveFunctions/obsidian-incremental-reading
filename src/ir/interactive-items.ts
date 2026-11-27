/**
 * SuperMemo 20 Interactive Item Formats (`~/code/sm20-re` Pillar D1):
 * - Typed-answer Cloze / Spell-Pad (`TSpellDlg`): `{{c1:=answer}}` / `{{c1:=answer::hint}}`
 * - Multiple-Choice (`TChoicesDlg`): fenced ```ir-mcq blocks
 * - Sequence Ordering (`TOrderEditor`): fenced ```ir-order blocks
 */

import { escapeClozeHtmlFragment, parseClozeInner } from "../cloze";
import type { SmGrade } from "./sm20-scheduler";

// --- 1. Spell-Pad Typed Cloze (`{{cN:=answer::hint}}`) ----------------------

export const TYPED_CLOZE_RE = /\{\{c(\d+):=([\s\S]*?)\}\}/g;

export interface TypedClozeGroup {
  n: number;
  answer: string;
  hint?: string;
}

export interface TypedDiffSegment {
  kind: "equal" | "missing" | "extra";
  text: string;
}

export interface TypedAnswerEvaluation {
  exactMatch: boolean;
  normalizedMatch: boolean;
  accuracy: number;
  suggestedSmGrade: SmGrade;
  segments: TypedDiffSegment[];
}

export function hasTypedCloze(text: string): boolean {
  TYPED_CLOZE_RE.lastIndex = 0;
  return TYPED_CLOZE_RE.test(text);
}

export function wrapTypedCloze(answer: string, n = 1, hint?: string): string {
  const h = hint?.trim();
  if (h && !h.includes("::")) {
    return `{{c${n}:=${answer}::${h}}}`;
  }
  return `{{c${n}:=${answer}}}`;
}

export function extractTypedClozes(text: string): TypedClozeGroup[] {
  const out: TypedClozeGroup[] = [];
  const re = /\{\{c(\d+):=([\s\S]*?)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const parsed = parseClozeInner(m[2] ?? "");
    out.push({
      n,
      answer: parsed.answer,
      ...(parsed.hint !== undefined ? { hint: parsed.hint } : {}),
    });
  }
  return out;
}

export function transformTypedClozes(
  text: string,
  replacer: (group: TypedClozeGroup, inCodeSpan: boolean) => string,
): string {
  const re = /(`)?\{\{c(\d+):=([\s\S]*?)\}\}(`)?/g;
  return text.replace(re, (_full, openTick: string | undefined, nStr: string, inner: string, closeTick: string | undefined) => {
    const inCodeSpan = Boolean(openTick && closeTick);
    const parsed = parseClozeInner(inner);
    const replaced = replacer(
      {
        n: Number(nStr),
        answer: parsed.answer,
        ...(parsed.hint !== undefined ? { hint: parsed.hint } : {}),
      },
      inCodeSpan,
    );
    if (!inCodeSpan && (openTick || closeTick)) {
      return `${openTick ?? ""}${replaced}${closeTick ?? ""}`;
    }
    return replaced;
  });
}

function normalizeSpellAnswer(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\-_.,;:'"!?()[\]{}]+/g, " ")
    .trim();
}

/**
 * Character-by-character LCS alignment matching SM-20's `TSpellDlg` feedback.
 */
export function diffTypedAnswer(
  expectedRaw: string,
  actualRaw: string,
  caseSensitive = false,
): TypedAnswerEvaluation {
  const expected = expectedRaw.trim();
  const actual = actualRaw.trim();
  const exactMatch = expected === actual;
  const normalizedMatch =
    !caseSensitive && normalizeSpellAnswer(expected) === normalizeSpellAnswer(actual);

  const a = caseSensitive ? expected : expected.toLowerCase();
  const b = caseSensitive ? actual : actual.toLowerCase();
  const m = a.length;
  const n = b.length;

  if (m === 0 && n === 0) {
    return {
      exactMatch: true,
      normalizedMatch: true,
      accuracy: 1,
      suggestedSmGrade: 5,
      segments: [],
    };
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const lcsLen = dp[m]![n]!;
  const maxLen = Math.max(m, n, 1);
  const accuracy = Math.round((lcsLen / maxLen) * 1000) / 1000;

  // Backtrack LCS to build compact segments
  const revOps: Array<{ kind: TypedDiffSegment["kind"]; ch: string }> = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      revOps.push({ kind: "equal", ch: expected[i - 1]! });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      revOps.push({ kind: "extra", ch: actual[j - 1]! });
      j -= 1;
    } else {
      revOps.push({ kind: "missing", ch: expected[i - 1]! });
      i -= 1;
    }
  }
  revOps.reverse();

  const segments: TypedDiffSegment[] = [];
  for (const op of revOps) {
    const prev = segments[segments.length - 1];
    if (prev && prev.kind === op.kind) {
      prev.text += op.ch;
    } else {
      segments.push({ kind: op.kind, text: op.ch });
    }
  }

  let suggestedSmGrade: SmGrade;
  if (exactMatch) suggestedSmGrade = 5;
  else if (normalizedMatch) suggestedSmGrade = 4;
  else if (accuracy >= 0.8) suggestedSmGrade = 3;
  else if (accuracy >= 0.5) suggestedSmGrade = 2;
  else suggestedSmGrade = 1;

  return {
    exactMatch,
    normalizedMatch,
    accuracy,
    suggestedSmGrade,
    segments,
  };
}

// --- 2. Multiple-Choice (`ir-mcq`) ------------------------------------------

export const MCQ_LANG = "ir-mcq";
export const MCQ_BLOCK_RE = /```ir-mcq[ \t]*\r?\n([\s\S]*?)\r?\n```/;

export interface McqOption {
  text: string;
  correct: boolean;
}

export interface McqSpec {
  prompt: string;
  options: McqOption[];
}

export function hasMcqBlock(text: string): boolean {
  return MCQ_BLOCK_RE.test(text);
}

export function parseMcqPayload(raw: string): McqSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Partial<McqSpec>;
      if (typeof obj.prompt === "string" && Array.isArray(obj.options) && obj.options.length >= 2) {
        const options = obj.options
          .filter((o): o is McqOption => Boolean(o && typeof o.text === "string" && typeof o.correct === "boolean"))
          .map((o) => ({ text: o.text.trim(), correct: o.correct }));
        if (options.length >= 2 && options.some((o) => o.correct)) {
          return { prompt: obj.prompt.trim(), options };
        }
      }
    } catch {
      // Fall through to line syntax
    }
  }

  const promptLines: string[] = [];
  const options: McqOption[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const starMatch = /^\*\s+(.+)$/.exec(line) ?? /^-\s*\[[xX]\]\s+(.+)$/.exec(line);
    if (starMatch) {
      options.push({ text: starMatch[1]!.trim(), correct: true });
      continue;
    }
    const dashMatch = /^-\s*(?:\[\s*\])?\s*(.+)$/.exec(line);
    if (dashMatch) {
      options.push({ text: dashMatch[1]!.trim(), correct: false });
      continue;
    }
    if (options.length === 0) {
      promptLines.push(line);
    }
  }

  if (options.length < 2 || !options.some((o) => o.correct)) return null;
  return {
    prompt: promptLines.join("\n").trim(),
    options,
  };
}

export function parseMcqBlock(body: string): McqSpec | null {
  const m = MCQ_BLOCK_RE.exec(body);
  if (!m) return null;
  return parseMcqPayload(m[1] ?? "");
}

function seededRng(seed: number): () => number {
  let a = (seed || 1) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleMcqOptions(options: readonly McqOption[], seed = 1): McqOption[] {
  const out = options.map((o) => ({ ...o }));
  const rng = seededRng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export function gradeMcqSelection(
  options: readonly McqOption[],
  selectedIndices: readonly number[],
): { correct: boolean; suggestedSmGrade: SmGrade } {
  const selected = new Set(selectedIndices);
  if (selected.size === 0) {
    return { correct: false, suggestedSmGrade: 1 };
  }
  let allMatch = true;
  for (let i = 0; i < options.length; i += 1) {
    if (options[i]!.correct !== selected.has(i)) {
      allMatch = false;
      break;
    }
  }
  return {
    correct: allMatch,
    suggestedSmGrade: allMatch ? 4 : 1,
  };
}

// --- 3. Ordering / Sequence (`ir-order`) ------------------------------------

export const ORDER_LANG = "ir-order";
export const ORDER_BLOCK_RE = /```ir-order[ \t]*\r?\n([\s\S]*?)\r?\n```/;

export interface OrderSpec {
  prompt: string;
  items: string[];
}

export function hasOrderBlock(text: string): boolean {
  return ORDER_BLOCK_RE.test(text);
}

export function parseOrderPayload(raw: string): OrderSpec | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Partial<OrderSpec>;
      if (Array.isArray(obj.items) && obj.items.length >= 2) {
        const items = obj.items
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim());
        if (items.length >= 2) {
          return { prompt: typeof obj.prompt === "string" ? obj.prompt.trim() : "", items };
        }
      }
    } catch {
      // Fall through to line syntax
    }
  }

  const promptLines: string[] = [];
  const items: string[] = [];
  for (const rawLine of trimmed.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const itemMatch = /^(?:\d+[.)]|[-*])\s+(.+)$/.exec(line);
    if (itemMatch) {
      items.push(itemMatch[1]!.trim());
      continue;
    }
    if (items.length === 0) {
      promptLines.push(line);
    }
  }
  if (items.length < 2) return null;
  return {
    prompt: promptLines.join("\n").trim(),
    items,
  };
}

export function parseOrderBlock(body: string): OrderSpec | null {
  const m = ORDER_BLOCK_RE.exec(body);
  if (!m) return null;
  return parseOrderPayload(m[1] ?? "");
}

export function scrambleOrderItems(items: readonly string[], seed = 1): string[] {
  const out = [...items];
  if (out.length < 2) return out;
  const rng = seededRng(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  // Guarantee non-identical permutation when possible so learner actually reorders
  if (out.every((v, idx) => v === items[idx]) && new Set(items).size > 1) {
    const firstDiff = out.findIndex((v) => v !== out[0]);
    const swapIdx = firstDiff > 0 ? firstDiff : 1;
    const tmp = out[0]!;
    out[0] = out[swapIdx]!;
    out[swapIdx] = tmp;
  }
  return out;
}

export function moveOrderItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  if (
    fromIndex < 0 ||
    fromIndex >= next.length ||
    toIndex < 0 ||
    toIndex >= next.length ||
    fromIndex === toIndex
  ) {
    return next;
  }
  const [picked] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, picked!);
  return next;
}

export function gradeOrderedSequence(
  expected: readonly string[],
  actual: readonly string[],
): { exactMatch: boolean; accuracy: number; suggestedSmGrade: SmGrade } {
  if (expected.length === 0 || expected.length !== actual.length) {
    return { exactMatch: false, accuracy: 0, suggestedSmGrade: 1 };
  }
  let matches = 0;
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i] === actual[i]) matches += 1;
  }
  const accuracy = Math.round((matches / expected.length) * 1000) / 1000;
  const exactMatch = matches === expected.length;
  const suggestedSmGrade: SmGrade = exactMatch ? 4 : accuracy >= 0.5 ? 2 : 1;
  return { exactMatch, accuracy, suggestedSmGrade };
}

export function hasInteractiveQuiz(text: string): boolean {
  return hasTypedCloze(text) || hasMcqBlock(text) || hasOrderBlock(text);
}

export function formatTypedClozeHtml(
  group: TypedClozeGroup,
  revealed: boolean,
  inCodeSpan: boolean,
): string {
  const html = revealed
    ? `<mark class="ir-cloze-answer">${escapeClozeHtmlFragment(group.answer)}</mark>`
    : `<mark class="ir-cloze-elision"><span class="ir-cloze-gap">[ type${group.hint ? `: ${escapeClozeHtmlFragment(group.hint)}` : ""} ]</span></mark>`;
  return inCodeSpan ? `<code>${html}</code>` : html;
}

/**
 * Ephemeral in-memory store preserving `ir-mcq` option toggles and `ir-order`
 * sequence moves across Markdown re-renders (e.g. when revealing an answer in
 * `IrReviewView`).
 */
export class QuizSessionStore {
  private readonly mcqSelections = new Map<string, Set<number>>();
  private readonly orderSequences = new Map<string, string[]>();

  getMcqSelection(key: string): ReadonlySet<number> {
    return this.mcqSelections.get(key) ?? new Set<number>();
  }

  toggleMcqOption(key: string, optionIndex: number): ReadonlySet<number> {
    let set = this.mcqSelections.get(key);
    if (!set) {
      set = new Set<number>();
      this.mcqSelections.set(key, set);
    }
    if (set.has(optionIndex)) set.delete(optionIndex);
    else set.add(optionIndex);
    return set;
  }

  getOrInitOrder(key: string, canonicalItems: readonly string[], seed = 1): string[] {
    const existing = this.orderSequences.get(key);
    if (existing && existing.length === canonicalItems.length) {
      return [...existing];
    }
    const scrambled = scrambleOrderItems(canonicalItems, seed);
    this.orderSequences.set(key, scrambled);
    return [...scrambled];
  }

  moveOrder(key: string, fromIndex: number, toIndex: number): string[] {
    const cur = this.orderSequences.get(key);
    if (!cur) return [];
    const next = moveOrderItem(cur, fromIndex, toIndex);
    this.orderSequences.set(key, next);
    return [...next];
  }

  resetKey(key: string): void {
    this.mcqSelections.delete(key);
    this.orderSequences.delete(key);
  }
}
