import { Editor, MarkdownView, Menu, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, IrSettingTab, IrSettings } from "./src/settings";
import {
  IrNoteResult,
  createCloze,
  createExtract,
  getIrType,
  getPriority,
  isDismissed,
  markAsTopic,
  setDismissed,
  setPriority,
} from "./src/ir-note";
import { ReviewModal, dueQueue } from "./src/review";
import { PriorityModal } from "./src/priority-modal";
import { IrStore, META } from "./src/ir/store";
import {
  ObsidianVaultFs,
  type ObsidianDataAdapter,
} from "./src/ir/obsidian-vault-fs";
import { migrateNotes, type FrontmatterNote } from "./src/ir/migrate";

export default class IncrementalReadingPlugin extends Plugin {
  settings: IrSettings = DEFAULT_SETTINGS;

  /**
   * The store, constructed once the layout exists (after a migration, or
   * immediately when `.ir/` is already present). The live queue/review
   * wiring reads through this in a follow-up; for now it only holds the
   * migrated log so the controller can reconcile it.
   */
  private store?: IrStore;

  async onload() {
    await this.loadSettings();
    await this.runMigrationIfOwed();
    this.addSettingTab(new IrSettingTab(this.app, this));

    this.addRibbonIcon("book-open", "Mark note as IR topic", () => {
      void this.markActiveFileAsTopic();
    });

    this.addRibbonIcon("brain-circuit", "Start IR review", () => {
      this.startReview();
    });

    this.addCommand({
      id: "start-review",
      name: "Start IR review",
      callback: () => this.startReview(),
    });

    this.addCommand({
      id: "set-ir-priority",
      name: "Set IR priority of current element",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || !getIrType(this.app, file)) {
          return false;
        }
        if (!checking) {
          const cur = getPriority(
            this.app,
            file,
            this.settings.defaultPriority,
          );
          new PriorityModal(this.app, cur, (p) => {
            void setPriority(this.app, file, p).then(() =>
              new Notice(`Priority of "${file.basename}" set to ${p}.`),
            );
          }).open();
        }
        return true;
      },
    });

    this.addCommand({
      id: "toggle-dismiss",
      name: "Dismiss / restore current IR element",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md" || !getIrType(this.app, file)) {
          return false;
        }
        if (!checking) void this.toggleDismiss(file);
        return true;
      },
    });

    this.addCommand({
      id: "mark-as-ir-topic",
      name: "Mark current note as IR topic",
      // checkCallback so the command only appears when there's a markdown
      // note to act on, per Obsidian command-design guidance.
      checkCallback: (checking: boolean) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") return false;
        if (!checking) void this.markActiveFileAsTopic(file);
        return true;
      },
    });

    // SuperMemo parity: Alt+X extract, Alt+Z cloze. Defaults only; users
    // can rebind or clear them in Settings -> Hotkeys.
    this.addCommand({
      id: "extract-selection",
      name: "Extract selection to IR child note",
      hotkeys: [{ modifiers: ["Alt"], key: "x" }],
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !editor.getSelection().trim()) return false;
        if (!checking) void this.extractSelection(editor, view.file);
        return true;
      },
    });

    this.addCommand({
      id: "cloze-selection",
      name: "Cloze selection into an IR item",
      hotkeys: [{ modifiers: ["Alt"], key: "z" }],
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !editor.getSelection().trim()) return false;
        if (!checking) void this.clozeSelection(editor, view.file);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on(
        "editor-menu",
        (menu: Menu, editor: Editor, view: MarkdownView) => {
          if (!view.file || !editor.getSelection().trim()) return;
          const file = view.file;
          menu.addItem((item) =>
            item
              .setTitle("Extract to IR child note")
              .setIcon("scissors")
              .onClick(() => void this.extractSelection(editor, file)),
          );
          menu.addItem((item) =>
            item
              .setTitle("Cloze to IR item")
              .setIcon("brackets")
              .onClick(() => void this.clozeSelection(editor, file)),
          );
        },
      ),
    );
  }

  private async extractSelection(editor: Editor, source: TFile) {
    const result = await createExtract(
      this.app,
      source,
      editor.getSelection(),
      this.settings,
    );
    await this.openResult(result, "Extracted to");
  }

  private async clozeSelection(editor: Editor, source: TFile) {
    const result = await createCloze(
      this.app,
      source,
      editor,
      this.settings,
    );
    await this.openResult(result, "Cloze item created:");
  }

  private startReview() {
    if (dueQueue(this.app, this.settings.reviewsPerReading).length === 0) {
      new Notice("Incremental Reading: nothing due for review.");
      return;
    }
    new ReviewModal(this.app, this, this.settings).open();
  }

  private async toggleDismiss(file: TFile) {
    const dismiss = !isDismissed(this.app, file);
    await setDismissed(this.app, file, dismiss);
    new Notice(
      `${dismiss ? "Dismissed" : "Restored"} "${file.basename}".`,
    );
  }

  private async openResult(result: IrNoteResult, verb: string) {
    if (!result.file) {
      new Notice(`Incremental Reading: ${result.error}`);
      return;
    }
    new Notice(`${verb} "${result.file.basename}".`);
    await this.app.workspace.getLeaf(true).openFile(result.file);
  }

  private async markActiveFileAsTopic(file?: TFile) {
    const target = file ?? this.app.workspace.getActiveFile();
    if (!target || target.extension !== "md") {
      new Notice("Incremental Reading: no active Markdown note.");
      return;
    }

    const existing = getIrType(this.app, target);
    if (existing === "topic") {
      new Notice(`"${target.basename}" is already an IR topic.`);
      return;
    }

    const marked = await markAsTopic(this.app, target, this.settings);
    if (marked) {
      new Notice(`Marked "${target.basename}" as an IR topic.`);
    }
  }

  /**
   * Migration controller (maintainer-owned; see docs/DESIGN.md "Integration").
   *
   * This is the one place that touches both worlds: it constructs the store
   * over the Obsidian data adapter, decides whether a migration is owed,
   * drives the *pure* `migrateNotes` transform with frontmatter read out of
   * `metadataCache`, and lands the result through the store's append +
   * reconcile path.
   *
   * Three invariants make this safe enough to run unattended on load, since
   * no mechanical oracle can gate a one-way data move:
   *
   * - Guarded / runs once. The presence of `.ir/meta.json` is the marker.
   *   `store.init()` writes it (with `device.json`) before any append, so a
   *   second load short-circuits here.
   * - Reversible. Nothing touches note frontmatter. The old `ir-` keys stay
   *   the live source of truth until the user confirms cutover; the migrated
   *   log is written alongside under `.ir/`, never in place of anything.
   * - Idempotent. `migrateNotes` derives element and event ids from the note
   *   path, so even if the marker were lost and this re-ran, the fold
   *   collapses the re-created elements to the identical state.
   *
   * A failure is reported and swallowed: a half-written `.ir/` is inert while
   * frontmatter remains authoritative, and breaking `onload` would take the
   * whole plugin (commands, review) down with it.
   */
  private async runMigrationIfOwed(): Promise<void> {
    const fs = new ObsidianVaultFs(
      this.app.vault.adapter as unknown as ObsidianDataAdapter,
    );
    const store = new IrStore(fs);

    try {
      // Detection happens before init(): init() is what writes the marker.
      if (await fs.exists(META)) {
        this.store = store;
        return;
      }

      // Marker + device id first, so the append below has a shard to write
      // to and a re-run sees the marker.
      await store.init();

      const notes = this.enumerateIrNotes();
      const events = migrateNotes(notes, Date.now());
      for (const ev of events) {
        await store.appendEvent(ev);
      }
      await store.reconcile();

      this.store = store;
      if (events.length > 0) {
        new Notice(
          `Incremental Reading: migrated ${events.length} element` +
            `${events.length === 1 ? "" : "s"} into the new store. ` +
            `Frontmatter is kept as a fallback.`,
        );
      }
    } catch (e) {
      console.error("Incremental Reading: migration failed", e);
      new Notice(
        "Incremental Reading: store migration failed; your notes are " +
          "untouched and still drive the plugin. See the developer console.",
      );
    }
  }

  /**
   * Enumerate IR notes via `metadataCache` and shape them for the pure
   * migration. We hand `migrateNotes` only notes that already declare an
   * `ir-type` (it filters again by construction); the cached frontmatter is
   * exactly what the old frontmatter readers consumed, so migrated state is
   * equivalent to what the live plugin saw.
   */
  private enumerateIrNotes(): FrontmatterNote[] {
    const out: FrontmatterNote[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm && getIrType(this.app, file)) {
        out.push({
          path: file.path,
          frontmatter: fm as Record<string, unknown>,
        });
      }
    }
    return out;
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<IrSettings> | null,
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
