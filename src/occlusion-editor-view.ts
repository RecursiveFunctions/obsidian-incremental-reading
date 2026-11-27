/**
 * Image occlusion editor: a workspace leaf (not a modal, UI commitment #6)
 * where the user draws rectangle OR polygon (`THitEditor`) masks over an image
 * and turns each one into an IR item card.
 *
 * Keyboard-first (commitment #1):
 * - Enter creates the items (or closes an active polygon draft if >= 3 points)
 * - P toggles Rect vs Polygon tool
 * - C closes an in-progress polygon
 * - Delete/Backspace removes the selected mask (or last draft vertex)
 * - M toggles Hide-all vs Hide-one mode
 * - Tab cycles masks, arrows nudge, Escape cancels draft or closes
 */

import { ItemView, Notice, Platform, WorkspaceLeaf } from "obsidian";
import type { NormalizedRect } from "./ir/model";
import {
  finalizeDraftPolygon,
  nextRectNumber,
  normalizeDragRect,
  type OcclusionMode,
  type OcclusionPolygon,
  type OcclusionRect,
} from "./ir/occlusion";

export const IR_OCCLUSION_EDITOR_VIEW_TYPE = "ir-occlusion-editor";

export interface OcclusionEditorSession {
  /** Vault path of the image being masked. */
  imagePath: string;
  /** Resolved `app.vault.getResourcePath` URL for the `<img>`. */
  imageUrl: string;
  /** Display-only: which note the cards will be filed under. */
  parentLabel: string;
  mode: OcclusionMode;
  rects?: OcclusionRect[];
  polygons?: OcclusionPolygon[];
  onCreate: (
    rects: OcclusionRect[],
    mode: OcclusionMode,
    polygons?: OcclusionPolygon[],
  ) => Promise<void>;
  onCancel?: () => void;
}

type SelectedShape =
  | { kind: "rect"; index: number }
  | { kind: "poly"; index: number }
  | null;

export class IrOcclusionEditorView extends ItemView {
  private session: OcclusionEditorSession | null = null;
  private rects: OcclusionRect[] = [];
  private polygons: OcclusionPolygon[] = [];
  private draftPoly: Array<[number, number]> = [];
  private drawTool: "rect" | "poly" = "rect";
  private mode: OcclusionMode = "hide-all";
  private selected: SelectedShape = null;
  private stage: HTMLElement | null = null;
  private labelInput: HTMLInputElement | null = null;
  private createBtn: HTMLButtonElement | null = null;
  private busy = false;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return IR_OCCLUSION_EDITOR_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IR image occlusion";
  }

  getIcon(): string {
    return "scan";
  }

  startSession(session: OcclusionEditorSession): void {
    this.session = session;
    this.rects = session.rects ? session.rects.map((r) => ({ ...r })) : [];
    this.polygons = session.polygons
      ? session.polygons.map((p) => ({ ...p, points: p.points.map(([x, y]) => [x, y]) }))
      : [];
    this.draftPoly = [];
    this.drawTool = "rect";
    this.mode = session.mode;
    this.selected = null;
    this.render();
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("ir-occlusion-editor");
    this.registerDomEvent(this.contentEl, "keydown", (evt) =>
      this.onKey(evt),
    );
    this.contentEl.setAttr("tabindex", "0");
    this.render();
  }

  async onClose(): Promise<void> {
    const s = this.session;
    this.session = null;
    s?.onCancel?.();
  }

  private totalMaskCount(): number {
    return this.rects.length + this.polygons.length;
  }

  private commitDraftPolygon(): boolean {
    const poly = finalizeDraftPolygon(this.draftPoly, this.rects, this.polygons);
    this.draftPoly = [];
    if (!poly) return false;
    this.polygons.push(poly);
    this.selected = { kind: "poly", index: this.polygons.length - 1 };
    this.render();
    return true;
  }

  private onKey(evt: KeyboardEvent): void {
    const typing =
      evt.target instanceof HTMLInputElement ||
      evt.target instanceof HTMLTextAreaElement;
    if (evt.key === "Escape") {
      evt.preventDefault();
      if (typing) {
        this.contentEl.focus();
        return;
      }
      if (this.draftPoly.length > 0) {
        this.draftPoly = [];
        this.paintMasks();
        return;
      }
      this.leaf.detach();
      return;
    }
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      if (!typing && this.draftPoly.length >= 3) {
        this.commitDraftPolygon();
        return;
      }
      void this.create();
      return;
    }
    if (typing) return;
    if (evt.key === "p" || evt.key === "P") {
      evt.preventDefault();
      this.drawTool = this.drawTool === "rect" ? "poly" : "rect";
      this.draftPoly = [];
      this.render();
      return;
    }
    if ((evt.key === "c" || evt.key === "C") && this.draftPoly.length >= 3) {
      evt.preventDefault();
      this.commitDraftPolygon();
      return;
    }
    if (evt.key === "Delete" || evt.key === "Backspace") {
      evt.preventDefault();
      if (this.draftPoly.length > 0) {
        this.draftPoly.pop();
        this.paintMasks();
        return;
      }
      this.deleteSelected();
      return;
    }
    if (evt.key === "m" || evt.key === "M") {
      evt.preventDefault();
      this.mode = this.mode === "hide-all" ? "hide-one" : "hide-all";
      this.render();
      return;
    }
    const total = this.totalMaskCount();
    if (evt.key === "Tab" && total > 0) {
      evt.preventDefault();
      const all: Array<Exclude<SelectedShape, null>> = [
        ...this.rects.map((_, index) => ({ kind: "rect" as const, index })),
        ...this.polygons.map((_, index) => ({ kind: "poly" as const, index })),
      ];
      const curIdx = this.selected
        ? all.findIndex((s) => s.kind === this.selected!.kind && s.index === this.selected!.index)
        : -1;
      const next = evt.shiftKey
        ? (curIdx - 1 + all.length) % all.length
        : (curIdx + 1) % all.length;
      this.selected = all[next]!;
      this.render();
      return;
    }
    if (
      this.selected?.kind === "rect" &&
      (evt.key === "ArrowLeft" ||
        evt.key === "ArrowRight" ||
        evt.key === "ArrowUp" ||
        evt.key === "ArrowDown")
    ) {
      evt.preventDefault();
      const step = evt.shiftKey ? 0.02 : 0.005;
      const r = this.rects[this.selected.index]!;
      if (evt.key === "ArrowLeft") r.x = Math.max(0, r.x - step);
      if (evt.key === "ArrowRight") r.x = Math.min(1 - r.w, r.x + step);
      if (evt.key === "ArrowUp") r.y = Math.max(0, r.y - step);
      if (evt.key === "ArrowDown") r.y = Math.min(1 - r.h, r.y + step);
      this.render();
    }
  }

  private deleteSelected(): void {
    if (!this.selected) return;
    if (this.selected.kind === "rect") {
      this.rects.splice(this.selected.index, 1);
    } else {
      this.polygons.splice(this.selected.index, 1);
    }
    this.selected = null;
    this.render();
  }

  private selectedLabel(): string {
    if (!this.selected) return "";
    return this.selected.kind === "rect"
      ? (this.rects[this.selected.index]?.label ?? "")
      : (this.polygons[this.selected.index]?.label ?? "");
  }

  private async create(): Promise<void> {
    const s = this.session;
    if (!s || this.busy) return;
    if (this.draftPoly.length >= 3) {
      this.commitDraftPolygon();
    }
    if (this.totalMaskCount() === 0) {
      new Notice("Incremental Reading: draw at least one mask first.");
      return;
    }
    this.busy = true;
    if (this.createBtn) this.createBtn.disabled = true;
    try {
      const rects = this.rects.map((r) => ({ ...r }));
      const polygons = this.polygons.map((p) => ({
        ...p,
        points: p.points.map(([x, y]) => [x, y] as [number, number]),
      }));
      await s.onCreate(rects, this.mode, polygons.length > 0 ? polygons : undefined);
      this.session = null;
      this.leaf.detach();
    } catch (e) {
      console.error("Incremental Reading: occlusion item creation failed", e);
      new Notice(
        "Incremental Reading: could not create the occlusion items. See the developer console.",
      );
      this.busy = false;
      if (this.createBtn) this.createBtn.disabled = false;
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const s = this.session;
    if (!s) {
      root.createEl("p", {
        cls: "ir-occlusion-editor-empty",
        text:
          "No image loaded. Right-click an image in a note (or use “Image occlusion items from image”) to start.",
      });
      return;
    }

    const toolbar = root.createDiv({ cls: "ir-occlusion-toolbar" });
    toolbar.createSpan({
      cls: "ir-occlusion-toolbar-title",
      text: `Masks for ${s.imagePath.split("/").pop() ?? s.imagePath} → ${s.parentLabel}`,
    });

    const toolWrap = toolbar.createDiv({ cls: "ir-occlusion-toolbar-group" });
    toolWrap.createSpan({ text: "Shape" });
    const toolSel = toolWrap.createEl("select", { cls: "dropdown" });
    toolSel.createEl("option", { value: "rect", text: "Rectangle" });
    toolSel.createEl("option", { value: "poly", text: "Polygon (P)" });
    toolSel.value = this.drawTool;
    toolSel.addEventListener("change", () => {
      this.drawTool = toolSel.value === "poly" ? "poly" : "rect";
      this.draftPoly = [];
      this.render();
    });

    const modeWrap = toolbar.createDiv({ cls: "ir-occlusion-toolbar-group" });
    modeWrap.createSpan({ text: "Mode" });
    const modeSel = modeWrap.createEl("select", { cls: "dropdown" });
    modeSel.createEl("option", { value: "hide-all", text: "Hide all, guess one" });
    modeSel.createEl("option", { value: "hide-one", text: "Hide one, show rest" });
    modeSel.value = this.mode;
    modeSel.addEventListener("change", () => {
      this.mode = modeSel.value === "hide-one" ? "hide-one" : "hide-all";
      this.render();
    });

    const labelWrap = toolbar.createDiv({ cls: "ir-occlusion-toolbar-group" });
    labelWrap.createSpan({ text: "Label" });
    const labelInput = labelWrap.createEl("input", {
      type: "text",
      placeholder: this.selected === null ? "select a mask" : "optional hint / caption",
    });
    labelInput.disabled = this.selected === null;
    labelInput.value = this.selectedLabel();
    labelInput.addEventListener("input", () => {
      if (!this.selected) return;
      const v = labelInput.value.trim();
      const target =
        this.selected.kind === "rect"
          ? this.rects[this.selected.index]
          : this.polygons[this.selected.index];
      if (!target) return;
      if (v) target.label = v;
      else delete target.label;
      this.paintMasks();
    });
    this.labelInput = labelInput;

    const total = this.totalMaskCount();
    const btns = toolbar.createDiv({ cls: "ir-occlusion-toolbar-group" });
    if (this.drawTool === "poly" && this.draftPoly.length >= 3) {
      const closePolyBtn = btns.createEl("button", { text: "Close polygon (C)" });
      closePolyBtn.addEventListener("click", () => this.commitDraftPolygon());
    }
    const delBtn = btns.createEl("button", { text: "Delete mask" });
    delBtn.disabled = this.selected === null;
    delBtn.addEventListener("click", () => this.deleteSelected());
    const clearBtn = btns.createEl("button", { text: "Clear" });
    clearBtn.disabled = total === 0 && this.draftPoly.length === 0;
    clearBtn.addEventListener("click", () => {
      this.rects = [];
      this.polygons = [];
      this.draftPoly = [];
      this.selected = null;
      this.render();
    });
    const cancelBtn = btns.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.leaf.detach());
    const createBtn = btns.createEl("button", {
      cls: "mod-cta",
      text: `Create ${total} item${total === 1 ? "" : "s"}`,
    });
    createBtn.disabled = total === 0;
    createBtn.addEventListener("click", () => void this.create());
    this.createBtn = createBtn;

    root.createEl("p", {
      cls: "ir-occlusion-help",
      text:
        this.drawTool === "poly"
          ? "Click vertices to outline polygon · click near first vertex or press C / Enter to close · P switches to Rectangle · Esc cancels draft"
          : Platform.isMobile
            ? "Drag on the image to draw a mask. Tap a mask to select it."
            : "Drag to draw a rectangle · P switches to Polygon · click mask to select · Del removes · M toggles mode · Enter creates items",
    });

    const stageWrap = root.createDiv({ cls: "ir-occlusion-stage-wrap" });
    const stage = stageWrap.createDiv({ cls: "ir-occlusion-stage" });
    const img = stage.createEl("img", { cls: "ir-occlusion-img" });
    img.setAttr("src", s.imageUrl);
    img.setAttr("alt", "");
    img.setAttr("draggable", "false");
    this.stage = stage;
    this.wireDrawing(stage);
    this.paintMasks();
    if (this.selected !== null) labelInput.focus();
    else root.focus();
  }

  private paintMasks(): void {
    const stage = this.stage;
    if (!stage) return;
    stage.querySelectorAll(".ir-occlusion-mask, .ir-occlusion-poly-layer").forEach((n) => n.remove());
    this.rects.forEach((r, i) => {
      const mask = stage.createDiv({
        cls: "ir-occlusion-mask ir-occlusion-mask--masked ir-occlusion-mask--editable",
      });
      mask.style.left = `${r.x * 100}%`;
      mask.style.top = `${r.y * 100}%`;
      mask.style.width = `${r.w * 100}%`;
      mask.style.height = `${r.h * 100}%`;
      if (this.selected?.kind === "rect" && this.selected.index === i) {
        mask.addClass("ir-occlusion-mask--selected");
      }
      const tag = mask.createSpan({ cls: "ir-occlusion-mask-tag", text: String(r.n) });
      if (r.label) tag.setText(`${r.n} · ${r.label}`);
      mask.addEventListener("mousedown", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        this.selected = { kind: "rect", index: i };
        this.render();
      });
    });

    if (this.polygons.length > 0 || this.draftPoly.length > 0) {
      const svg = stage.createSvg("svg", {
        cls: "ir-occlusion-poly-layer",
        attr: { viewBox: "0 0 100 100", preserveAspectRatio: "none" },
      });
      svg.style.position = "absolute";
      svg.style.inset = "0";
      svg.style.width = "100%";
      svg.style.height = "100%";
      svg.style.pointerEvents = "none";

      this.polygons.forEach((p, idx) => {
        const isSel = this.selected?.kind === "poly" && this.selected.index === idx;
        const pts = p.points.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(" ");
        const polyEl = svg.createSvg("polygon", {
          attr: {
            points: pts,
            fill: "var(--interactive-accent)",
            "fill-opacity": isSel ? "0.65" : "0.42",
            stroke: isSel ? "var(--text-normal)" : "var(--interactive-accent)",
            "stroke-width": isSel ? "1.2" : "0.7",
          },
        });
        polyEl.style.pointerEvents = "auto";
        polyEl.style.cursor = "pointer";
        polyEl.addEventListener("mousedown", (evt) => {
          evt.stopPropagation();
          evt.preventDefault();
          this.selected = { kind: "poly", index: idx };
          this.render();
        });
      });

      if (this.draftPoly.length > 0) {
        const pts = this.draftPoly.map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`).join(" ");
        svg.createSvg("polyline", {
          attr: {
            points: pts,
            fill: "none",
            stroke: "var(--interactive-accent)",
            "stroke-width": "0.9",
            "stroke-dasharray": "2,1.5",
          },
        });
        for (const [vx, vy] of this.draftPoly) {
          svg.createSvg("circle", {
            attr: {
              cx: (vx * 100).toFixed(2),
              cy: (vy * 100).toFixed(2),
              r: "1.3",
              fill: "var(--interactive-accent)",
            },
          });
        }
      }
    }
  }

  private wireDrawing(stage: HTMLElement): void {
    let drawing: HTMLElement | null = null;
    let sx = 0;
    let sy = 0;
    const norm = (cx: number, cy: number) => {
      const box = stage.getBoundingClientRect();
      return {
        x: Math.min(1, Math.max(0, (cx - box.left) / Math.max(1, box.width))),
        y: Math.min(1, Math.max(0, (cy - box.top) / Math.max(1, box.height))),
      };
    };

    if (this.drawTool === "poly") {
      stage.addEventListener("mousedown", (evt) => {
        if (evt.button !== 0) return;
        evt.preventDefault();
        const pt = norm(evt.clientX, evt.clientY);
        if (this.draftPoly.length >= 3) {
          const [fx, fy] = this.draftPoly[0]!;
          if (Math.hypot(pt.x - fx, pt.y - fy) < 0.035) {
            this.commitDraftPolygon();
            return;
          }
        }
        this.draftPoly.push([pt.x, pt.y]);
        if (this.draftPoly.length === 3) {
          this.render();
        } else {
          this.paintMasks();
        }
      });
      stage.addEventListener("dblclick", (evt) => {
        evt.preventDefault();
        if (this.draftPoly.length >= 3) {
          this.commitDraftPolygon();
        }
      });
      return;
    }

    const onMove = (evt: MouseEvent) => {
      if (!drawing) return;
      evt.preventDefault();
      const a = norm(sx, sy);
      const b = norm(evt.clientX, evt.clientY);
      drawing.style.left = `${Math.min(a.x, b.x) * 100}%`;
      drawing.style.top = `${Math.min(a.y, b.y) * 100}%`;
      drawing.style.width = `${Math.abs(b.x - a.x) * 100}%`;
      drawing.style.height = `${Math.abs(b.y - a.y) * 100}%`;
    };
    const onUp = (evt: MouseEvent) => {
      if (!drawing) return;
      const a = norm(sx, sy);
      const b = norm(evt.clientX, evt.clientY);
      drawing.remove();
      drawing = null;
      stage.ownerDocument.removeEventListener("mousemove", onMove, true);
      stage.ownerDocument.removeEventListener("mouseup", onUp, true);
      const rect: NormalizedRect | null = normalizeDragRect(a.x, a.y, b.x, b.y);
      if (!rect) {
        this.selected = null;
        this.render();
        return;
      }
      this.rects.push({ ...rect, n: nextRectNumber(this.rects, this.polygons) });
      this.selected = { kind: "rect", index: this.rects.length - 1 };
      this.render();
    };
    stage.addEventListener("mousedown", (evt) => {
      if (evt.button !== 0) return;
      evt.preventDefault();
      sx = evt.clientX;
      sy = evt.clientY;
      drawing = stage.createDiv({ cls: "ir-occlusion-mask ir-occlusion-mask--drawing" });
      stage.ownerDocument.addEventListener("mousemove", onMove, true);
      stage.ownerDocument.addEventListener("mouseup", onUp, true);
    });
    stage.addEventListener("touchstart", (evt) => {
      const t = evt.touches[0];
      if (!t) return;
      evt.preventDefault();
      sx = t.clientX;
      sy = t.clientY;
      drawing = stage.createDiv({ cls: "ir-occlusion-mask ir-occlusion-mask--drawing" });
    }, { passive: false });
    stage.addEventListener("touchmove", (evt) => {
      const t = evt.touches[0];
      if (!t || !drawing) return;
      evt.preventDefault();
      onMove({ clientX: t.clientX, clientY: t.clientY, preventDefault() {} } as MouseEvent);
    }, { passive: false });
    stage.addEventListener("touchend", (evt) => {
      const t = evt.changedTouches[0];
      if (!t || !drawing) return;
      onUp({ clientX: t.clientX, clientY: t.clientY } as MouseEvent);
    });
  }
}
