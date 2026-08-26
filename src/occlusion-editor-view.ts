/**
 * Image occlusion editor: a workspace leaf (not a modal, UI commitment #6)
 * where the user draws masks over an image and turns each one into an IR
 * item card. Keyboard-first (commitment #1): Enter creates the cards,
 * Delete/Backspace removes the selected mask, Escape closes, M toggles the
 * mode, arrows nudge the selected mask.
 *
 * The view owns no IR state. It hands the finished rect list back through
 * `onCreate`; the host plugin turns it into item notes and store events.
 */

import { ItemView, Notice, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import type { NormalizedRect } from "./ir/model";
import {
  nextRectNumber,
  normalizeDragRect,
  type OcclusionMode,
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
  /** Pre-seeded rects (re-editing is not supported yet; usually empty). */
  rects?: OcclusionRect[];
  onCreate: (rects: OcclusionRect[], mode: OcclusionMode) => Promise<void>;
  onCancel?: () => void;
}

export class IrOcclusionEditorView extends ItemView {
  private session: OcclusionEditorSession | null = null;
  private rects: OcclusionRect[] = [];
  private mode: OcclusionMode = "hide-all";
  private selected: number | null = null;
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

  /** Load a fresh editing session; called by the plugin right after opening. */
  startSession(session: OcclusionEditorSession): void {
    this.session = session;
    this.rects = session.rects ? session.rects.map((r) => ({ ...r })) : [];
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
      this.leaf.detach();
      return;
    }
    if (evt.key === "Enter" && !evt.shiftKey) {
      evt.preventDefault();
      void this.create();
      return;
    }
    if (typing) return;
    if (evt.key === "Delete" || evt.key === "Backspace") {
      evt.preventDefault();
      this.deleteSelected();
      return;
    }
    if (evt.key === "m" || evt.key === "M") {
      evt.preventDefault();
      this.mode = this.mode === "hide-all" ? "hide-one" : "hide-all";
      this.render();
      return;
    }
    if (evt.key === "Tab" && this.rects.length > 0) {
      evt.preventDefault();
      const idx = this.selected ?? -1;
      const next = evt.shiftKey
        ? (idx - 1 + this.rects.length) % this.rects.length
        : (idx + 1) % this.rects.length;
      this.selected = next;
      this.render();
      return;
    }
    if (
      this.selected !== null &&
      (evt.key === "ArrowLeft" ||
        evt.key === "ArrowRight" ||
        evt.key === "ArrowUp" ||
        evt.key === "ArrowDown")
    ) {
      evt.preventDefault();
      const step = evt.shiftKey ? 0.02 : 0.005;
      const r = this.rects[this.selected]!;
      if (evt.key === "ArrowLeft") r.x = Math.max(0, r.x - step);
      if (evt.key === "ArrowRight") r.x = Math.min(1 - r.w, r.x + step);
      if (evt.key === "ArrowUp") r.y = Math.max(0, r.y - step);
      if (evt.key === "ArrowDown") r.y = Math.min(1 - r.h, r.y + step);
      this.render();
    }
  }

  private deleteSelected(): void {
    if (this.selected === null) return;
    this.rects.splice(this.selected, 1);
    this.selected = null;
    this.render();
  }

  private async create(): Promise<void> {
    const s = this.session;
    if (!s || this.busy) return;
    if (this.rects.length === 0) {
      new Notice("Incremental Reading: draw at least one mask first.");
      return;
    }
    this.busy = true;
    if (this.createBtn) this.createBtn.disabled = true;
    try {
      const rects = this.rects.map((r) => ({ ...r }));
      await s.onCreate(rects, this.mode);
      this.session = null; // prevent onCancel from firing on detach
      this.leaf.detach();
    } catch (e) {
      console.error("Incremental Reading: occlusion card creation failed", e);
      new Notice(
        "Incremental Reading: could not create the occlusion cards. See the developer console.",
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
          "No image loaded. Right-click an image in a note (or use “Image occlusion cards from image”) to start.",
      });
      return;
    }

    const toolbar = root.createDiv({ cls: "ir-occlusion-toolbar" });
    toolbar.createSpan({
      cls: "ir-occlusion-toolbar-title",
      text: `Masks for ${s.imagePath.split("/").pop() ?? s.imagePath} → ${s.parentLabel}`,
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
    labelInput.value =
      this.selected !== null ? (this.rects[this.selected]?.label ?? "") : "";
    labelInput.addEventListener("input", () => {
      if (this.selected === null) return;
      const v = labelInput.value.trim();
      const r = this.rects[this.selected]!;
      if (v) r.label = v;
      else delete r.label;
      this.paintMasks();
    });
    this.labelInput = labelInput;

    const btns = toolbar.createDiv({ cls: "ir-occlusion-toolbar-group" });
    const delBtn = btns.createEl("button", { text: "Delete mask" });
    delBtn.disabled = this.selected === null;
    delBtn.addEventListener("click", () => this.deleteSelected());
    const clearBtn = btns.createEl("button", { text: "Clear" });
    clearBtn.disabled = this.rects.length === 0;
    clearBtn.addEventListener("click", () => {
      this.rects = [];
      this.selected = null;
      this.render();
    });
    const cancelBtn = btns.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.leaf.detach());
    const createBtn = btns.createEl("button", {
      cls: "mod-cta",
      text: `Create ${this.rects.length} card${this.rects.length === 1 ? "" : "s"}`,
    });
    createBtn.disabled = this.rects.length === 0;
    createBtn.addEventListener("click", () => void this.create());
    this.createBtn = createBtn;

    root.createEl("p", {
      cls: "ir-occlusion-help",
      text: Platform.isMobile
        ? "Drag on the image to draw a mask. Tap a mask to select it."
        : "Drag to draw a mask · click a mask to select · Del removes · Tab cycles · arrows nudge · M toggles mode · Enter creates the cards · Esc closes",
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
    stage.querySelectorAll(".ir-occlusion-mask").forEach((n) => n.remove());
    this.rects.forEach((r, i) => {
      const mask = stage.createDiv({
        cls: "ir-occlusion-mask ir-occlusion-mask--masked ir-occlusion-mask--editable",
      });
      mask.style.left = `${r.x * 100}%`;
      mask.style.top = `${r.y * 100}%`;
      mask.style.width = `${r.w * 100}%`;
      mask.style.height = `${r.h * 100}%`;
      if (i === this.selected) mask.addClass("ir-occlusion-mask--selected");
      const tag = mask.createSpan({ cls: "ir-occlusion-mask-tag", text: String(r.n) });
      if (r.label) tag.setText(`${r.n} · ${r.label}`);
      mask.addEventListener("mousedown", (evt) => {
        evt.stopPropagation();
        evt.preventDefault();
        this.selected = i;
        this.render();
      });
    });
  }

  private wireDrawing(stage: HTMLElement): void {
    let drawing: HTMLElement | null = null;
    let sx = 0;
    let sy = 0;
    const norm = (cx: number, cy: number) => {
      const box = stage.getBoundingClientRect();
      return {
        x: (cx - box.left) / Math.max(1, box.width),
        y: (cy - box.top) / Math.max(1, box.height),
      };
    };
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
        // A click, not a drag: clear the selection.
        this.selected = null;
        this.render();
        return;
      }
      this.rects.push({ ...rect, n: nextRectNumber(this.rects) });
      this.selected = this.rects.length - 1;
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
    // Touch: map to the same handlers via pointer events on mobile.
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
