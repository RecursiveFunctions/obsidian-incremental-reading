/**
 * Decoration-only extract highlights (DESIGN §Q3).
 *
 * The source note is never mutated by extract creation. Highlights for
 * existing anchors are painted into the editor's render tree only, via a
 * CodeMirror 6 StateField. Anchors live in the store; this module resolves
 * them against the current note body and pushes the resulting decoration
 * set into every open MarkdownView whose file matches.
 *
 * Reading view and the review pane are NOT covered by this module's CM6
 * path — see DESIGN §Q3. Reading view uses the post-processor below.
 * Cloze coverage uses the same pipeline with `mark.ir-cloze-source`.
 * Legacy notes that still carry persisted
 * `<mark class="ir-extract-source">` chrome continue to render in those
 * surfaces because the CSS class is unchanged.
 */

import type { App, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import {
  StateEffect,
  StateField,
  type Extension,
  type Range as CmRange,
} from "@codemirror/state";
import type { IrStore } from "./store";
import type { Anchor, IrElement } from "./model";
import { resolveAnchor } from "./anchor";
import {
  paintIrSourceMarksInElement,
} from "./extract-reading-marks";
import {
  clozeRangesInBody,
  type SourceMarkKind,
} from "./cloze-marks";

export { paintIrSourceMarksInElement } from "./extract-reading-marks";

/** CSS class shared with pre-§Q3 inline marks so styles.css needs no change. */
const EXTRACT_CLASS = "ir-extract-source";
const CLOZE_CLASS = "ir-cloze-source";
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/**
 * Resolved anchor entry held in the decoration cache. CM6 needs `start`/`end`
 * for the editor decoration; the reading-view post-processor needs `text`
 * (the extract's stored, markdown-stripped body) as the text-quote needle to
 * search the rendered DOM for. Storing both lets a single cache feed both
 * surfaces without re-resolving anchors per render.
 */
export interface CachedAnchor {
  start: number;
  end: number;
  /** The extract element's `text` field: chrome stripped, ready to match. */
  text: string;
  kind: SourceMarkKind;
}

/**
 * Workspace-singleton cache: vault path -> resolved anchor ranges in
 * body-relative offsets. Built by {@link refreshIrDecorationCache} after
 * every store reconcile. The CM6 extension reads from this through
 * {@link pushIrDecorations}; the reading-view post-processor through
 * {@link createIrExtractMarkdownPostProcessor}.
 */
export class IrDecorationCache {
  private byPath = new Map<string, CachedAnchor[]>();
  private gen = 0;

  rangesFor(path: string): CachedAnchor[] {
    return this.byPath.get(path) ?? [];
  }

  generation(): number {
    return this.gen;
  }

  set(next: Map<string, CachedAnchor[]>): void {
    this.byPath = next;
    this.gen += 1;
  }
}

/**
 * Re-resolve every extract anchor in the store against its source's current
 * body and rebuild the cache. Anchors that can't resolve right now (their
 * source moved, the text was edited away) are simply absent from the cache:
 * they still exist in the store and surface as "needs re-anchor" elsewhere.
 *
 * Idempotent; safe to call after every reconcile.
 */
export async function refreshIrDecorationCache(
  app: App,
  store: IrStore,
  cache: IrDecorationCache,
): Promise<void> {
  const state = await store.load();
  const byPath = new Map<
    string,
    Array<{ anchor: Anchor; text: string }>
  >();
  for (const [, el] of state.elements) {
    if (el.type !== "extract") continue;
    // Promoted (standalone-note) extracts keep their anchors so the source
    // topic can still show what was pulled out. Skip only when there is no
    // markdown anchor left to paint.
    if (!el.anchor) continue;
    if (el.anchor.pdf) continue; // painted by pdf-decorations, not CM6
    if (el.anchorState === "detached") continue;
    const bucket = byPath.get(el.anchor.sourcePath) ?? [];
    bucket.push({ anchor: el.anchor, text: el.text });
    byPath.set(el.anchor.sourcePath, bucket);
  }

  const items = Array.from(state.elements.values()).filter(
    (e: IrElement) => e.type === "item",
  );
  const paths = new Set<string>(byPath.keys());
  for (const el of items) {
    const p = el.anchor?.sourcePath;
    if (p) paths.add(p);
    if (el.notePath) {
      /* item notes are not the source; parent path is resolved below */
    }
  }
  for (const el of items) {
    let cur: IrElement | undefined = el;
    const seen = new Set<string>([el.id]);
    while (cur?.parentId) {
      if (seen.has(cur.parentId)) break;
      seen.add(cur.parentId);
      cur = state.elements.get(cur.parentId);
      if (cur?.notePath) paths.add(cur.notePath);
      if (cur?.anchor?.sourcePath) paths.add(cur.anchor.sourcePath);
    }
  }

  const next = new Map<string, CachedAnchor[]>();
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (!file || !("extension" in file) || file.extension !== "md") continue;
    const full = await app.vault.cachedRead(file as TFile);
    const body = stripFrontmatterPlain(full);
    const ranges: CachedAnchor[] = [];
    for (const { anchor, text } of byPath.get(path) ?? []) {
      const r = resolveAnchor(anchor, body);
      if (r.status === "ok") {
        ranges.push({ start: r.start, end: r.end, text, kind: "extract" });
      }
    }
    ranges.push(...clozeRangesInBody(items, body, path, state.elements));
    if (ranges.length > 0) next.set(path, ranges);
  }
  cache.set(next);
}

/** Inline copy of frontmatter-body.stripFrontmatter, kept here for isolation. */
function stripFrontmatterPlain(full: string): string {
  return full.replace(FRONTMATTER_RE, "").trim();
}

/**
 * Editor-relative offset of the body's first character. Matches the math
 * `frontmatter-body.bodyOffsetsFromFullOffsets` uses in the inverse
 * direction so a round-trip is exact.
 */
function bodyStartInFull(full: string): number {
  const fm = full.match(FRONTMATTER_RE);
  const fmLen = fm ? fm[0].length : 0;
  const afterFm = full.slice(fmLen);
  const leadingWs = afterFm.length - afterFm.trimStart().length;
  return fmLen + leadingWs;
}

/* ------------------------------------------------------------------ */
/* CodeMirror 6 extension                                              */
/* ------------------------------------------------------------------ */

/**
 * `tagName: "mark"` is load-bearing: `styles.css` selectors are written as
 * `mark.ir-extract-source` so they match the pre-§Q3 inline-HTML highlight
 * format. Without it CM6 wraps the range in a `<span>` that the existing
 * CSS doesn't target, and the decoration is present but invisible.
 */
const irExtractMark = Decoration.mark({
  class: EXTRACT_CLASS,
  tagName: "mark",
});
const irClozeMark = Decoration.mark({
  class: CLOZE_CLASS,
  tagName: "mark",
});

/**
 * Effect that replaces the entire decoration set for an editor. We rebuild
 * wholesale rather than diffing because the cache changes far less often
 * than the buffer, and the resolved-range list per file is small.
 */
const setIrDecorations = StateEffect.define<DecorationSet>();

const irDecorationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    // Map existing decorations through user edits so they track the text
    // they highlight between cache rebuilds.
    let next = value.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setIrDecorations)) next = e.value;
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** CM6 extension to register via `Plugin.registerEditorExtension`. */
export function irExtractDecorationsExtension(): Extension {
  return [irDecorationsField];
}

/**
 * Resolve body-relative ranges into a DecorationSet attached to `view`. Body
 * offsets are mapped into full-file offsets and clipped to the doc length,
 * so a stale cache never throws.
 */
function decorationsForView(
  view: EditorView,
  ranges: ReadonlyArray<CachedAnchor>,
): DecorationSet {
  if (ranges.length === 0) return Decoration.none;
  const full = view.state.doc.toString();
  const offset = bodyStartInFull(full);
  const docLen = view.state.doc.length;
  const out: CmRange<Decoration>[] = [];
  for (const r of ranges) {
    const from = Math.max(0, Math.min(docLen, r.start + offset));
    const to = Math.max(from, Math.min(docLen, r.end + offset));
    if (to > from) {
      const mark = r.kind === "cloze" ? irClozeMark : irExtractMark;
      out.push(mark.range(from, to));
    }
  }
  out.sort((a, b) => a.from - b.from);
  return Decoration.set(out, true);
}

/**
 * Push the current cache state into every open MarkdownView's editor. The
 * main plugin calls this after every reconcile and on workspace layout
 * changes.
 */
export function pushIrDecorations(
  app: App,
  cache: IrDecorationCache,
): void {
  app.workspace.iterateAllLeaves((leaf) => {
    const v = leaf.view;
    if (!(v instanceof MarkdownView)) return;
    const file = v.file;
    if (!file) return;
    // `editor.cm` is the underlying EditorView. Typed as untyped on
    // MarkdownView, so we narrow defensively.
    const cm = (v.editor as unknown as { cm?: EditorView }).cm;
    if (!cm) return;
    const ranges = cache.rangesFor(file.path);
    cm.dispatch({
      effects: setIrDecorations.of(decorationsForView(cm, ranges)),
    });
  });
}

/* ------------------------------------------------------------------ */
/* Reading view post-processor                                          */
/* ------------------------------------------------------------------ */

/** Minimal post-processor context shape we depend on (avoids importing the type). */
interface PostProcessorContext {
  sourcePath?: string;
}

/**
 * Build the `MarkdownPostProcessor` registered against Obsidian's reading
 * view. For each section block rendered from a known IR source path, walks
 * the rendered text nodes and wraps each extract's text in
 * `<mark class="ir-extract-source">` (Nth occurrence when quotes repeat).
 *
 * Limitations (best-effort, §Q3 reading-view path):
 * - Only matches within a single text node. An extract that spans inline
 *   formatting boundaries (e.g. text crossing a `<strong>`) won't be found.
 * - Identical quotes at different offsets each get a mark (Nth occurrence
 *   of that needle). Spans that already sit inside an IR mark are not
 *   wrapped again.
 * - Needles shorter than 4 characters are skipped to avoid noisy matches.
 */
export function createIrExtractMarkdownPostProcessor(
  cache: IrDecorationCache,
): (el: HTMLElement, ctx: PostProcessorContext) => void {
  return (el, ctx) => {
    const path = ctx?.sourcePath;
    if (!path) return;
    const ranges = cache.rangesFor(path);
    if (ranges.length === 0) return;
    paintIrSourceMarksInElement(
      el,
      ranges
        .filter((r) => r.kind !== "cloze")
        .map((r) => ({ text: r.text, cls: EXTRACT_CLASS })),
    );
    paintIrSourceMarksInElement(
      el,
      ranges
        .filter((r) => r.kind === "cloze")
        .map((r) => ({ text: r.text, cls: CLOZE_CLASS })),
    );
  };
}
