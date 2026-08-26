/**
 * SuperMemo-style multi-selection: hold Ctrl (Cmd on macOS) while selecting
 * and every span you release is *held*; the next Extract joins all held
 * spans plus the live selection into one extract.
 *
 * The set itself is pure (this module's `PendingSelections`) so the
 * accumulate / dedupe / clear rules are unit-tested. The DOM glue that
 * listens for Ctrl+mouseup and paints held spans with the CSS Custom
 * Highlight API lives in `src/ir/multi-select-dom.ts`.
 */

import type { PdfSegment } from "./model";

/** A held span captured from a PDF text layer. */
export interface PdfHeldSelection {
  kind: "pdf";
  /** Vault path of the PDF. */
  pdfPath: string;
  text: string;
  segments: PdfSegment[];
}

/**
 * A held span captured from a rendered markdown body (reading view or the
 * review card). Offsets are into the note body (frontmatter stripped),
 * resolved at capture time because the DOM may be re-rendered before the
 * extract runs.
 */
export interface BodyHeldSelection {
  kind: "body";
  /** Vault path of the note whose body the offsets index. */
  sourcePath: string;
  text: string;
  start: number;
  end: number;
}

export type HeldSelection = PdfHeldSelection | BodyHeldSelection;

/** Identity used for dedupe: same source + same span = same hold. */
export function heldSelectionKey(s: HeldSelection): string {
  if (s.kind === "pdf") {
    const segs = s.segments
      .map((g) => `${g.page}:${g.selection.join(",")}`)
      .join("|");
    return `pdf:${s.pdfPath}:${segs}:${s.text}`;
  }
  return `body:${s.sourcePath}:${s.start}-${s.end}`;
}

export class PendingSelections {
  private items: HeldSelection[] = [];

  /** Add a span; returns false if an identical span is already held. */
  add(sel: HeldSelection): boolean {
    if (!sel.text.trim()) return false;
    const key = heldSelectionKey(sel);
    if (this.items.some((s) => heldSelectionKey(s) === key)) return false;
    this.items.push(sel);
    return true;
  }

  /** Remove the most recently held span (Ctrl+Z-style undo of a hold). */
  pop(): HeldSelection | undefined {
    return this.items.pop();
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }

  list(): ReadonlyArray<HeldSelection> {
    return this.items;
  }

  /** Held PDF spans for one PDF, in hold order. */
  pdf(pdfPath: string): PdfHeldSelection[] {
    return this.items.filter(
      (s): s is PdfHeldSelection => s.kind === "pdf" && s.pdfPath === pdfPath,
    );
  }

  /** Held body spans for one note, in hold order. */
  body(sourcePath: string): BodyHeldSelection[] {
    return this.items.filter(
      (s): s is BodyHeldSelection =>
        s.kind === "body" && s.sourcePath === sourcePath,
    );
  }

  /** Drop every held span that belongs to `pdfPath` / `sourcePath`. */
  drop(pathKey: string): void {
    this.items = this.items.filter((s) =>
      s.kind === "pdf" ? s.pdfPath !== pathKey : s.sourcePath !== pathKey,
    );
  }
}

/**
 * Merge held spans with the live selection for an extract. The live span
 * is appended last unless it duplicates a held one. Returns the ordered
 * list to extract from, or an empty array when there is nothing.
 */
export function mergeWithLive<T extends HeldSelection>(
  held: ReadonlyArray<T>,
  live: T | null,
): T[] {
  const out = [...held];
  if (live && live.text.trim()) {
    const key = heldSelectionKey(live);
    if (!out.some((s) => heldSelectionKey(s) === key)) out.push(live);
  }
  return out;
}

/** True when the pointer event carries the multi-select modifier. */
export function isMultiSelectModifier(evt: {
  ctrlKey: boolean;
  metaKey: boolean;
}): boolean {
  return evt.ctrlKey || evt.metaKey;
}
