/**
 * DOM side of Ctrl-multi-select: keeps the held spans painted with the CSS
 * Custom Highlight API (`::highlight(ir-held-selection)`) so the user sees
 * what the next Extract will join. Falls back silently on engines without
 * the API; the held set still works, it just isn't painted.
 */

import { PendingSelections, type HeldSelection } from "./multi-select";

export const HELD_HIGHLIGHT_NAME = "ir-held-selection";
const HELD_LAYER_CLASS = "ir-pdf-held-layer";

/**
 * Held spans inside a pdf.js page get a real overlay (the text layer is
 * nearly transparent, so `::highlight` is invisible there). Non-PDF
 * surfaces keep the CSS Custom Highlight.
 */
function paintHeldPdfOverlays(ranges: ReadonlyArray<Range>): void {
  document.querySelectorAll(`.${HELD_LAYER_CLASS}`).forEach((el) => el.remove());
  for (const r of ranges) {
    if (r.collapsed) continue;
    const anc = r.commonAncestorContainer;
    const el = anc instanceof HTMLElement ? anc : anc.parentElement;
    const page = el?.closest<HTMLElement>(".page[data-page-number]");
    if (!page) continue;
    const pageBox = page.getBoundingClientRect();
    if (pageBox.width === 0 || pageBox.height === 0) continue;
    let layer = page.querySelector<HTMLElement>(`:scope > .${HELD_LAYER_CLASS}`);
    if (!layer) {
      layer = document.createElement("div");
      layer.className = HELD_LAYER_CLASS;
      const textLayer = page.querySelector(":scope > .textLayer");
      if (textLayer) page.insertBefore(layer, textLayer);
      else page.appendChild(layer);
    }
    for (const b of Array.from(r.getClientRects())) {
      if (b.width === 0 || b.height === 0) continue;
      const d = document.createElement("div");
      d.className = "ir-pdf-held-rect";
      d.style.left = `${((b.left - pageBox.left) / pageBox.width) * 100}%`;
      d.style.top = `${((b.top - pageBox.top) / pageBox.height) * 100}%`;
      d.style.width = `${(b.width / pageBox.width) * 100}%`;
      d.style.height = `${(b.height / pageBox.height) * 100}%`;
      layer.appendChild(d);
    }
  }
}

interface HighlightLike {
  add(range: AbstractRange): unknown;
  clear(): void;
}
interface HighlightRegistryLike {
  set(name: string, hl: HighlightLike): unknown;
  delete(name: string): unknown;
}

type GlobalWithHighlight = {
  CSS?: { highlights?: HighlightRegistryLike };
  Highlight?: new () => HighlightLike;
};

function highlightRegistry(): HighlightRegistryLike | null {
  const g = globalThis as unknown as GlobalWithHighlight;
  if (!g.CSS?.highlights || typeof g.Highlight !== "function") return null;
  return g.CSS.highlights;
}

function newHighlight(): HighlightLike | null {
  const g = globalThis as unknown as GlobalWithHighlight;
  return typeof g.Highlight === "function" ? new g.Highlight() : null;
}

export class MultiSelectController {
  readonly pending = new PendingSelections();
  private ranges: Range[] = [];

  constructor(private readonly onChange?: (count: number) => void) {}

  /** Hold a span; paints `range` when given. False when it was a duplicate. */
  hold(sel: HeldSelection, range: Range | null): boolean {
    if (!this.pending.add(sel)) return false;
    if (range) this.ranges.push(range.cloneRange());
    this.repaint();
    this.onChange?.(this.pending.size);
    return true;
  }

  /** Drop the most recent hold. */
  undo(): boolean {
    const dropped = this.pending.pop();
    if (!dropped) return false;
    this.ranges.pop();
    this.repaint();
    this.onChange?.(this.pending.size);
    return true;
  }

  clear(): void {
    if (this.pending.size === 0 && this.ranges.length === 0) return;
    this.pending.clear();
    this.ranges = [];
    this.repaint();
    this.onChange?.(0);
  }

  get size(): number {
    return this.pending.size;
  }

  private repaint(): void {
    paintHeldPdfOverlays(this.ranges);
    const reg = highlightRegistry();
    if (!reg) return;
    if (this.ranges.length === 0) {
      reg.delete(HELD_HIGHLIGHT_NAME);
      return;
    }
    const hl = newHighlight();
    if (!hl) return;
    for (const r of this.ranges) {
      // Collapsed ranges (the DOM they spanned was re-rendered) paint nothing.
      if (!r.collapsed) hl.add(r);
    }
    reg.set(HELD_HIGHLIGHT_NAME, hl);
  }

  dispose(): void {
    this.pending.clear();
    this.ranges = [];
    paintHeldPdfOverlays([]);
    highlightRegistry()?.delete(HELD_HIGHLIGHT_NAME);
  }
}
