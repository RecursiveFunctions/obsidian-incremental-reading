/**
 * SuperMemo 20 Progressive Reading & Matrix Visualization Helpers:
 * - `TWeb.DeleteBeforeCursor` (`0x00fa1240`) & `TWeb.DeleteAfterCursor`:
 *   progressive reading text chop preserving YAML frontmatter, `#SuperMemo Reference:`
 *   footers, and anchored child extract spans.
 * - `TIntervalChoiceForm_PaintHeatmap` / `Graph4D`: 20×20 Difficulty × Stability
 *   `SInc` heatmap projection.
 */

import {
  formatSuperMemoReferenceFooter,
  parseSuperMemoReferenceFooter,
  stripSuperMemoReferenceFooter,
} from "./concepts-references";
import { FRONTMATTER_RE, stripFrontmatter } from "./frontmatter-body";
import { lookupBlendedSinc, type Sm20Matrix } from "./sm20-matrix";
import { stabilityIndex20ToTransformed } from "./sm20-scheduler";

export interface ChopProtectedSpan {
  start: number;
  end: number;
}

export interface ChopReadingResult {
  ok: boolean;
  updatedFile?: string;
  updatedBody?: string;
  reason?: string;
}

function splitFrontmatterAndBody(fullFile: string): { frontmatterBlock: string; body: string } {
  const lf = fullFile.includes("\r\n") ? fullFile.replace(/\r\n/g, "\n") : fullFile;
  const m = FRONTMATTER_RE.exec(lf);
  const frontmatterBlock = m ? m[0].trimEnd() : "";
  const body = stripFrontmatter(lf);
  return { frontmatterBlock, body };
}

/**
 * Deletes reading text in `[0, bodyOffset)` while preserving YAML frontmatter
 * and any `#SuperMemo Reference:` footer (`0x00fa1240`).
 */
export function chopReadingTextBeforeOffset(
  fullFile: string,
  bodyOffset: number,
  protectedSpans: readonly ChopProtectedSpan[] = [],
): ChopReadingResult {
  const { frontmatterBlock, body } = splitFrontmatterAndBody(fullFile);
  const offset = Math.max(0, Math.min(body.length, Math.trunc(bodyOffset)));
  if (offset <= 0) {
    return { ok: false, reason: "Place the cursor past the text you want to delete." };
  }

  for (const span of protectedSpans) {
    if (span.start < offset) {
      return {
        ok: false,
        reason: "Cannot chop text containing an anchored child extract or cloze.",
      };
    }
  }

  const ref = parseSuperMemoReferenceFooter(body);
  const contentWithoutRef = stripSuperMemoReferenceFooter(body);
  if (offset >= contentWithoutRef.length) {
    return {
      ok: false,
      reason: "Chopping here would leave no reading text above the reference footer.",
    };
  }

  const remainingContent = contentWithoutRef.slice(offset).trimStart();
  if (!remainingContent) {
    return { ok: false, reason: "Chopping here would leave an empty note body." };
  }

  const refFooter = ref ? `\n\n${formatSuperMemoReferenceFooter(ref)}` : "";
  const updatedBody = `${remainingContent}${refFooter}`.trim();
  const updatedFile = frontmatterBlock
    ? `${frontmatterBlock}\n\n${updatedBody}\n`
    : `${updatedBody}\n`;

  return { ok: true, updatedFile, updatedBody };
}

/**
 * Deletes reading text in `(bodyOffset, endOfContent]` while preserving YAML
 * frontmatter and any `#SuperMemo Reference:` footer.
 */
export function chopReadingTextAfterOffset(
  fullFile: string,
  bodyOffset: number,
  protectedSpans: readonly ChopProtectedSpan[] = [],
): ChopReadingResult {
  const { frontmatterBlock, body } = splitFrontmatterAndBody(fullFile);
  const ref = parseSuperMemoReferenceFooter(body);
  const contentWithoutRef = stripSuperMemoReferenceFooter(body);
  const offset = Math.max(0, Math.min(contentWithoutRef.length, Math.trunc(bodyOffset)));

  if (offset >= contentWithoutRef.length) {
    return { ok: false, reason: "Nothing after the cursor to delete." };
  }

  for (const span of protectedSpans) {
    if (span.end > offset) {
      return {
        ok: false,
        reason: "Cannot chop text containing an anchored child extract or cloze.",
      };
    }
  }

  const remainingContent = contentWithoutRef.slice(0, offset).trimEnd();
  if (!remainingContent) {
    return { ok: false, reason: "Chopping here would leave an empty note body." };
  }

  const refFooter = ref ? `\n\n${formatSuperMemoReferenceFooter(ref)}` : "";
  const updatedBody = `${remainingContent}${refFooter}`.trim();
  const updatedFile = frontmatterBlock
    ? `${frontmatterBlock}\n\n${updatedBody}\n`
    : `${updatedBody}\n`;

  return { ok: true, updatedFile, updatedBody };
}

export interface Sm20SincHeatmap {
  /** `rows[dZero][sZero]` for `D1..D20` × `S1..S20`. */
  rows: number[][];
  minSinc: number;
  maxSinc: number;
  stabilityLabels: string[];
  difficultyLabels: string[];
}

export function computeSm20SincHeatmap20x20(
  matrix: Sm20Matrix | undefined,
  retrievability = 0.9,
): Sm20SincHeatmap {
  const rows: number[][] = [];
  let minSinc = Infinity;
  let maxSinc = -Infinity;

  const stabilityLabels = Array.from({ length: 20 }, (_, sZero) => {
    const s = stabilityIndex20ToTransformed(sZero + 1);
    return s >= 100 ? `${Math.round(s)}d` : `${s.toFixed(1)}d`;
  });
  const difficultyLabels = Array.from({ length: 20 }, (_, dZero) =>
    `D${dZero + 1}`,
  );

  for (let dZero = 0; dZero < 20; dZero += 1) {
    const d01 = dZero / 19.0;
    const row: number[] = [];
    for (let sZero = 0; sZero < 20; sZero += 1) {
      const s = stabilityIndex20ToTransformed(sZero + 1);
      const val = Math.round(lookupBlendedSinc(matrix, d01, s, retrievability) * 100) / 100;
      row.push(val);
      if (val < minSinc) minSinc = val;
      if (val > maxSinc) maxSinc = val;
    }
    rows.push(row);
  }

  return {
    rows,
    minSinc: Number.isFinite(minSinc) ? minSinc : 1,
    maxSinc: Number.isFinite(maxSinc) ? maxSinc : 2,
    stabilityLabels,
    difficultyLabels,
  };
}
