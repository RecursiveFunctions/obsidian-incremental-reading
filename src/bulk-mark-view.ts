import {
  ItemView,
  Notice,
  WorkspaceLeaf,
  type App,
  type TAbstractFile,
  TFolder,
} from "obsidian";
import {
  assembleBulkMarkCandidates,
  classifyVaultEntry,
  planBulkMarkPriorities,
  type BulkMarkSource,
  type BulkPriorityMode,
} from "./ir/bulk-mark-priority";
import type { FolderFileRef } from "./ir/folder-topics";
import { formatPriority } from "./ir/relative-priority";
import { createPriorityField } from "./priority-prompt";

export const IR_BULK_MARK_VIEW_TYPE = "ir-bulk-mark-view";

export interface BulkMarkCommitRequest {
  attempted: readonly FolderFileRef[];
  priorities: readonly number[];
}

export interface BulkMarkViewHost {
  app: App;
  defaultPriority: number;
  loadSkipPaths: () => Promise<Set<string>>;
  onCommit: (request: BulkMarkCommitRequest) => Promise<void>;
}

const NO_SKIP = new Set<string>();

export class IrBulkMarkView extends ItemView {
  private sources: BulkMarkSource[] = [];
  private modeKind: BulkPriorityMode["kind"] = "default";
  private fixedValue = "";
  private rangeMin = "0";
  private rangeMax = "100";
  private preview: FolderFileRef[] = [];
  private skipped: FolderFileRef[] = [];
  private previewError: string | null = null;
  private plannedPriorities: number[] = [];
  private previewEl: HTMLElement | null = null;
  private markBtn: HTMLButtonElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly host: BulkMarkViewHost,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return IR_BULK_MARK_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Bulk mark IR topics";
  }

  getIcon(): string {
    return "library";
  }

  async onOpen(): Promise<void> {
    await this.refreshPreview();
  }

  setSources(entries: readonly TAbstractFile[]): void {
    const seen = new Set<string>();
    this.sources = entries.flatMap((entry) => {
      const classified = classifyVaultEntry(entry);
      if (!classified || seen.has(classified.path)) return [];
      seen.add(classified.path);
      return [classified];
    });
    void this.refreshPreview();
  }

  addSource(entry: TAbstractFile): void {
    const classified = classifyVaultEntry(entry);
    if (!classified || this.sources.some((s) => s.path === classified.path)) {
      return;
    }
    this.sources = [...this.sources, classified];
    void this.refreshPreview();
  }

  private async refreshPreview(): Promise<void> {
    const skip = await this.host.loadSkipPaths();
    const refs = this.host.app.vault.getFiles().map((f) => ({
      path: f.path,
      extension: f.extension,
    }));
    const all = assembleBulkMarkCandidates(refs, this.sources, NO_SKIP);
    this.preview = all.filter((f) => !skip.has(f.path));
    this.skipped = all.filter((f) => skip.has(f.path));
    this.recomputePriorities();
    this.render();
  }

  private currentMode(): BulkPriorityMode {
    if (this.modeKind === "fixed") {
      return { kind: "fixed", value: Number(this.fixedValue) };
    }
    if (this.modeKind === "range") {
      return {
        kind: "range",
        min: Number(this.rangeMin),
        max: Number(this.rangeMax),
      };
    }
    return { kind: "default" };
  }

  private recomputePriorities(): void {
    const plan = planBulkMarkPriorities(
      this.preview.length,
      this.currentMode(),
      this.host.defaultPriority,
    );
    this.previewError = plan.ok ? null : plan.reason;
    this.plannedPriorities = plan.ok ? plan.priorities : [];
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("ir-bulk-mark-view");

    const header = container.createDiv({ cls: "ir-bulk-mark-header" });
    header.createEl("h4", { text: "Bulk mark as IR topics" });
    header.createEl("p", {
      cls: "ir-bulk-mark-hint",
      text:
        "Assemble folders and files, choose a placement priority mode, then mark. " +
        "Priorities are placement requests; fold projects final queue order.",
    });

    const sourcesEl = container.createDiv({ cls: "ir-bulk-mark-sources" });
    sourcesEl.createEl("div", {
      cls: "ir-bulk-mark-section-title",
      text: "Sources",
    });
    if (this.sources.length === 0) {
      sourcesEl.createEl("p", {
        cls: "ir-bulk-mark-empty",
        text: "Add a folder or files from the file explorer menu, or pick below.",
      });
    } else {
      for (const source of this.sources) {
        const row = sourcesEl.createDiv({ cls: "ir-bulk-mark-source-row" });
        row.createSpan({
          text: `${source.kind === "folder" ? "Folder" : "File"}: ${source.path || "/"}`,
        });
        row.createEl("button", { text: "Remove" }).onclick = () => {
          this.sources = this.sources.filter((s) => s.path !== source.path);
          void this.refreshPreview();
        };
      }
    }

    const addRow = sourcesEl.createDiv({ cls: "ir-bulk-mark-add" });
    addRow.createEl("button", { text: "Add active file" }).onclick = () => {
      const file = this.host.app.workspace.getActiveFile();
      if (!file) {
        new Notice("Incremental Reading: no active file.");
        return;
      }
      this.addSource(file);
    };
    addRow.createEl("button", { text: "Add active folder" }).onclick = () => {
      const file = this.host.app.workspace.getActiveFile();
      const folder = file?.parent instanceof TFolder ? file.parent : null;
      if (!folder) {
        new Notice("Incremental Reading: no folder for the active file.");
        return;
      }
      this.addSource(folder);
    };

    const modeEl = container.createDiv({ cls: "ir-bulk-mark-mode" });
    modeEl.createEl("div", {
      cls: "ir-bulk-mark-section-title",
      text: "Priority mode",
    });
    const modeSelect = modeEl.createEl("select", {
      cls: "dropdown",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["default", `Default (${formatPriority(this.host.defaultPriority)})`],
      ["fixed", "Fixed value for all"],
      ["range", "Even spacing across a range"],
    ] as const) {
      modeSelect.createEl("option", { value, text: label });
    }
    modeSelect.value = this.modeKind;
    modeSelect.onchange = () => {
      this.modeKind = modeSelect.value as BulkPriorityMode["kind"];
      this.recomputePriorities();
      this.render();
    };

    if (this.modeKind === "fixed") {
      this.fixedValue ||= formatPriority(this.host.defaultPriority);
      const input = createPriorityField(modeEl, "Priority", this.fixedValue);
      input.oninput = () => {
        this.fixedValue = input.value;
        this.recomputePriorities();
        this.updatePreview();
      };
    } else if (this.modeKind === "range") {
      const minInput = createPriorityField(modeEl, "Min", this.rangeMin);
      const maxInput = createPriorityField(modeEl, "Max", this.rangeMax);
      const onRange = () => {
        this.rangeMin = minInput.value;
        this.rangeMax = maxInput.value;
        this.recomputePriorities();
        this.updatePreview();
      };
      minInput.oninput = onRange;
      maxInput.oninput = onRange;
    }

    this.previewEl = container.createDiv({ cls: "ir-bulk-mark-preview" });
    const actions = container.createDiv({ cls: "ir-priority-actions" });
    this.markBtn = actions.createEl("button", {
      text: `Mark ${this.preview.length}`,
      cls: "mod-cta",
    });
    this.markBtn.onclick = () => {
      if (this.markBtn?.disabled) return;
      void this.host.onCommit({
        attempted: [...this.preview],
        priorities: [...this.plannedPriorities],
      });
    };
    this.updatePreview();
  }

  private updatePreview(): void {
    const previewEl = this.previewEl;
    if (!previewEl) return;
    previewEl.empty();
    const skipNote =
      this.skipped.length > 0 ? ` · ${this.skipped.length} already IR` : "";
    previewEl.createEl("div", {
      cls: "ir-bulk-mark-section-title",
      text: `Preview (${this.preview.length} ready${skipNote})`,
    });
    if (this.previewError) {
      previewEl.createEl("p", {
        cls: "ir-bulk-mark-error",
        text: this.previewError,
      });
    } else if (this.preview.length === 0 && this.skipped.length === 0) {
      previewEl.createEl("p", {
        cls: "ir-bulk-mark-empty",
        text: "No markdown notes or PDFs in the current sources.",
      });
    } else {
      const list = previewEl.createEl("ul", { cls: "ir-bulk-mark-list" });
      this.preview.forEach((ref, index) => {
        const p = this.plannedPriorities[index] ?? this.host.defaultPriority;
        list.createEl("li", { text: `${ref.path} → p${formatPriority(p)}` });
      });
      for (const ref of this.skipped) {
        list.createEl("li", {
          cls: "ir-bulk-mark-skipped",
          text: `${ref.path} (skip: already IR)`,
        });
      }
    }
    if (this.markBtn) {
      this.markBtn.textContent = `Mark ${this.preview.length}`;
      this.markBtn.disabled =
        this.preview.length === 0 ||
        this.previewError !== null ||
        this.plannedPriorities.length !== this.preview.length;
    }
  }
}
