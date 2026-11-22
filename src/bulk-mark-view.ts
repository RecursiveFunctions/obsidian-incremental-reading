/**
 * Side-panel staging View for bulk mark-as-topic with priority planning (#90).
 * Sources: folders and/or files; priority modes: default / fixed / even range.
 */

import {
  ItemView,
  Notice,
  WorkspaceLeaf,
  type App,
  type TAbstractFile,
  TFile,
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
import { PRIORITY_MAX, PRIORITY_MIN } from "./ir/model";

export const IR_BULK_MARK_VIEW_TYPE = "ir-bulk-mark-view";

export interface BulkMarkCommitRequest {
  /** Attempted set shown in the preview (invariant with closed #25). */
  attempted: readonly FolderFileRef[];
  priorities: readonly number[];
}

export interface BulkMarkViewHost {
  app: App;
  defaultPriority: number;
  /** Already-IR paths (ledger + frontmatter). */
  loadSkipPaths: () => Promise<Set<string>>;
  onCommit: (request: BulkMarkCommitRequest) => Promise<void>;
}

export class IrBulkMarkView extends ItemView {
  private sources: BulkMarkSource[] = [];
  private modeKind: BulkPriorityMode["kind"] = "default";
  private fixedValue = "";
  private rangeMin = "";
  private rangeMax = "";
  private preview: FolderFileRef[] = [];
  private previewError: string | null = null;
  private plannedPriorities: number[] = [];

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

  /** Replace staging sources (idempotent; deduped by path). */
  setSources(entries: readonly TAbstractFile[]): void {
    const next: BulkMarkSource[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const classified = classifyVaultEntry(entry);
      if (!classified || seen.has(classified.path)) continue;
      seen.add(classified.path);
      next.push(classified);
    }
    this.sources = next;
    void this.refreshPreview();
  }

  addSource(entry: TAbstractFile): void {
    const classified = classifyVaultEntry(entry);
    if (!classified) return;
    if (this.sources.some((s) => s.path === classified.path)) return;
    this.sources = [...this.sources, classified];
    void this.refreshPreview();
  }

  private vaultRefs(): FolderFileRef[] {
    return this.host.app.vault.getFiles().map((f) => ({
      path: f.path,
      extension: f.extension,
    }));
  }

  private async refreshPreview(): Promise<void> {
    const skip = await this.host.loadSkipPaths();
    this.preview = assembleBulkMarkCandidates(
      this.vaultRefs(),
      this.sources,
      skip,
    );
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
    if (!plan.ok) {
      this.previewError = plan.reason;
      this.plannedPriorities = [];
      return;
    }
    this.previewError = null;
    this.plannedPriorities = plan.priorities;
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
      const folder =
        file?.parent instanceof TFolder
          ? file.parent
          : file instanceof TFolder
            ? file
            : null;
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
      const field = modeEl.createEl("label", { cls: "ir-priority-field" });
      field.createSpan({ text: "Priority" });
      const input = field.createEl("input", {
        cls: "ir-priority-input",
      }) as HTMLInputElement;
      input.type = "number";
      input.min = String(PRIORITY_MIN);
      input.max = String(PRIORITY_MAX);
      input.step = "0.0001";
      input.value = this.fixedValue || formatPriority(this.host.defaultPriority);
      this.fixedValue = input.value;
      input.oninput = () => {
        this.fixedValue = input.value;
        this.recomputePriorities();
        this.renderPreviewOnly();
      };
    }

    if (this.modeKind === "range") {
      const minField = modeEl.createEl("label", { cls: "ir-priority-field" });
      minField.createSpan({ text: "Min" });
      const minInput = minField.createEl("input", {
        cls: "ir-priority-input",
      }) as HTMLInputElement;
      minInput.type = "number";
      minInput.min = String(PRIORITY_MIN);
      minInput.max = String(PRIORITY_MAX);
      minInput.step = "0.0001";
      minInput.value = this.rangeMin || "0";
      this.rangeMin = minInput.value;

      const maxField = modeEl.createEl("label", { cls: "ir-priority-field" });
      maxField.createSpan({ text: "Max" });
      const maxInput = maxField.createEl("input", {
        cls: "ir-priority-input",
      }) as HTMLInputElement;
      maxInput.type = "number";
      maxInput.min = String(PRIORITY_MIN);
      maxInput.max = String(PRIORITY_MAX);
      maxInput.step = "0.0001";
      maxInput.value = this.rangeMax || "100";
      this.rangeMax = maxInput.value;

      const onRange = () => {
        this.rangeMin = minInput.value;
        this.rangeMax = maxInput.value;
        this.recomputePriorities();
        this.renderPreviewOnly();
      };
      minInput.oninput = onRange;
      maxInput.oninput = onRange;
    }

    const previewEl = container.createDiv({ cls: "ir-bulk-mark-preview" });
    previewEl.createEl("div", {
      cls: "ir-bulk-mark-section-title",
      text: `Preview (${this.preview.length})`,
    });
    if (this.previewError) {
      previewEl.createEl("p", {
        cls: "ir-bulk-mark-error",
        text: this.previewError,
      });
    } else if (this.preview.length === 0) {
      previewEl.createEl("p", {
        cls: "ir-bulk-mark-empty",
        text: "No unmarked markdown notes or PDFs in the current sources.",
      });
    } else {
      const list = previewEl.createEl("ul", { cls: "ir-bulk-mark-list" });
      this.preview.forEach((ref, index) => {
        const p = this.plannedPriorities[index];
        list.createEl("li", {
          text: `${ref.path} → p${formatPriority(p ?? this.host.defaultPriority)}`,
        });
      });
    }

    const actions = container.createDiv({ cls: "ir-priority-actions" });
    const markBtn = actions.createEl("button", {
      text: `Mark ${this.preview.length}`,
      cls: "mod-cta",
    });
    markBtn.disabled =
      this.preview.length === 0 ||
      this.previewError !== null ||
      this.plannedPriorities.length !== this.preview.length;
    markBtn.onclick = () => {
      if (markBtn.disabled) return;
      void this.host.onCommit({
        attempted: [...this.preview],
        priorities: [...this.plannedPriorities],
      });
    };
  }

  /** Update preview copy without rebuilding inputs (keeps focus). */
  private renderPreviewOnly(): void {
    const previewEl = this.contentEl.querySelector(".ir-bulk-mark-preview");
    if (!previewEl) {
      this.render();
      return;
    }
    previewEl.empty();
    previewEl.createEl("div", {
      cls: "ir-bulk-mark-section-title",
      text: `Preview (${this.preview.length})`,
    });
    if (this.previewError) {
      previewEl.createEl("p", {
        cls: "ir-bulk-mark-error",
        text: this.previewError,
      });
    } else if (this.preview.length === 0) {
      previewEl.createEl("p", {
        cls: "ir-bulk-mark-empty",
        text: "No unmarked markdown notes or PDFs in the current sources.",
      });
    } else {
      const list = previewEl.createEl("ul", { cls: "ir-bulk-mark-list" });
      this.preview.forEach((ref, index) => {
        const p = this.plannedPriorities[index];
        list.createEl("li", {
          text: `${ref.path} → p${formatPriority(p ?? this.host.defaultPriority)}`,
        });
      });
    }
    const markBtn = this.contentEl.querySelector(
      ".ir-priority-actions button.mod-cta",
    ) as HTMLButtonElement | null;
    if (markBtn) {
      markBtn.textContent = `Mark ${this.preview.length}`;
      markBtn.disabled =
        this.preview.length === 0 ||
        this.previewError !== null ||
        this.plannedPriorities.length !== this.preview.length;
    }
  }
}
