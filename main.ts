import { Editor, MarkdownView, Menu, Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, IrSettingTab, IrSettings } from "./src/settings";
import { createExtract, getIrType, markAsTopic } from "./src/ir-note";

export default class IncrementalReadingPlugin extends Plugin {
  settings: IrSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new IrSettingTab(this.app, this));

    this.addRibbonIcon("book-open", "Mark note as IR topic", () => {
      void this.markActiveFileAsTopic();
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

    this.addCommand({
      id: "extract-selection",
      name: "Extract selection to IR child note",
      editorCheckCallback: (checking, editor, view) => {
        if (!view.file || !editor.getSelection().trim()) return false;
        if (!checking) void this.extractSelection(editor, view.file);
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
    if (!result.file) {
      new Notice(`Incremental Reading: ${result.error}`);
      return;
    }
    new Notice(`Extracted to "${result.file.basename}".`);
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

    const marked = await markAsTopic(
      this.app,
      target,
      this.settings.defaultPriority,
    );
    if (marked) {
      new Notice(`Marked "${target.basename}" as an IR topic.`);
    }
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
