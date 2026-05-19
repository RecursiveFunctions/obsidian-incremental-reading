import {
  Editor,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import { DEFAULT_SETTINGS, IrSettingTab, IrSettings } from "./src/settings";
import { IR_TREE_VIEW_TYPE, IrTreeView } from "./src/tree-view";
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
import { toAnkiTsv } from "./src/ir/anki-export";
import { StatsModal } from "./src/stats-modal";
import { planSourceDeletion } from "./src/ir/deletion";
import { nextLamport } from "./src/ir/log";
import { newEventId } from "./src/ir/ids";
import type { IrElement, IrEvent } from "./src/ir/model";
import type { ElementId } from "./src/ir/ids";
import { IR_KEYS } from "./src/types";
import { newTopicState, writeTopicToFrontmatter } from "./src/topic";
import { redistribute, type MercyEntry } from "./src/ir/mercy";

export default class IncrementalReadingPlugin extends Plugin {
  settings: IrSettings = DEFAULT_SETTINGS;

  /**
   * The store, constructed once the layout exists (after a migration, or
   * immediately when `.ir/` is already present). It is the source of truth
   * for the queue and review loop; frontmatter is dual-written on every
   * action only as the migration fallback.
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
      void this.startReview();
    });

    this.addCommand({
      id: "start-review",
      name: "Start IR review",
      callback: () => void this.startReview(),
    });

    this.registerView(
      IR_TREE_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => {
        if (!this.store) {
          throw new Error(
            "Incremental Reading: store not ready for tree view.",
          );
        }
        return new IrTreeView(leaf, this.store);
      },
    );

    this.addRibbonIcon("list-tree", "Open IR element tree", () => {
      void this.openTreeView();
    });

    this.addCommand({
      id: "open-tree-view",
      name: "Open IR element tree",
      callback: () => void this.openTreeView(),
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
      id: "export-anki-tsv",
      name: "Export IR items to Anki TSV",
      callback: () => void this.exportAnkiTsv(),
    });

    this.addCommand({
      id: "show-stats",
      name: "Show IR stats",
      callback: () => {
        if (!this.store) {
          new Notice("Incremental Reading: store is not ready.");
          return;
        }
        new StatsModal(this.app, this.store).open();
      },
    });

    this.addCommand({
      id: "mercy-postpone",
      name: "Postpone overdue elements (mercy)",
      callback: () => void this.runMercy(),
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

    // file-menu carries the note-level actions that have no hotkey path on
    // mobile (no keyboard, ribbon is hidden behind a swipe). Tapping the
    // three-dot button on a note surfaces this menu, so mark-as-topic,
    // priority, and dismiss live here as well.
    // Vault delete handler: when a source note disappears, the pure
    // planSourceDeletion decides which extracts auto-promote to standalone
    // notes (so their reviewable text never disappears) and emits a
    // source-tombstone event so the UI can offer re-link if the source ever
    // comes back via Sync/git/trash.
    this.registerEvent(
      this.app.vault.on("delete", (deleted) => {
        if (!(deleted instanceof TFile) || deleted.extension !== "md") return;
        void this.handleSourceDeletion(deleted);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const irType = getIrType(this.app, file);
        if (!irType) {
          menu.addItem((item) =>
            item
              .setTitle("Mark as IR topic")
              .setIcon("book-open")
              .onClick(() => void this.markActiveFileAsTopic(file)),
          );
          return;
        }
        menu.addItem((item) =>
          item
            .setTitle("Set IR priority")
            .setIcon("sliders-horizontal")
            .onClick(() => {
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
            }),
        );
        const dismissed = isDismissed(this.app, file);
        menu.addItem((item) =>
          item
            .setTitle(dismissed ? "Restore IR element" : "Dismiss IR element")
            .setIcon(dismissed ? "rotate-ccw" : "ban")
            .onClick(() => void this.toggleDismiss(file)),
        );
      }),
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(IR_TREE_VIEW_TYPE);
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

  private async startReview() {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const state = await this.store.load();
    const queue = dueQueue(this.app, this.settings.reviewsPerReading, state);
    if (queue.length === 0) {
      new Notice("Incremental Reading: nothing due for review.");
      return;
    }
    new ReviewModal(
      this.app,
      this,
      this.settings,
      this.store,
      queue,
    ).open();
  }

  private async openTreeView(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const existing = this.app.workspace.getLeavesOfType(IR_TREE_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Incremental Reading: no place to open the tree view.");
      return;
    }
    await leaf.setViewState({ type: IR_TREE_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Write a TSV of every active item to `<vault>/anki-ir.tsv`. The pure core
   * filters dismissed items, sorts by id, and writes the row guid as the
   * element id, so Anki imports merge in place across runs (deck definition
   * line in the header tells Anki where to put new items).
   */
  private async exportAnkiTsv(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const state = await this.store.load();
    const elements = Array.from(state.elements.values());
    const tsv = toAnkiTsv(elements, { deck: this.settings.ankiDeckName });
    const outPath = "anki-ir.tsv";
    await this.app.vault.adapter.write(outPath, tsv);
    const itemCount = elements.filter(
      (e) => e.type === "item" && !e.dismissed,
    ).length;
    new Notice(
      `Incremental Reading: wrote ${itemCount} item` +
        `${itemCount === 1 ? "" : "s"} to ${outPath}.`,
    );
  }

  /**
   * Apply mercy: if more than `mercyCeiling` elements are due today, push
   * the lowest-priority overflow forward by one day. Pure `redistribute`
   * decides which ids overflow and which are protected by the cutoff; the
   * wiring just bumps their due timestamps via `mercy-postponed` events.
   *
   * Scheduler state is untouched (DESIGN.md section 6 invariant). A later
   * grade or topic-advance lands at a higher lamport and overwrites the
   * postponement, so a postponed item that does get reviewed today keeps
   * its real next-due.
   */
  private async runMercy(): Promise<void> {
    if (!this.store) {
      new Notice("Incremental Reading: store is not ready.");
      return;
    }
    const now = Date.now();
    const state = await this.store.load();
    const elements = Array.from(state.elements.values());

    const entries: MercyEntry[] = [];
    for (const el of elements) {
      if (el.dismissed) continue;
      const due = el.card?.due ?? el.schedule?.due ?? null;
      if (due === null) continue;
      entries.push({ id: el.id, priority: el.priority, dueMs: due });
    }

    const result = redistribute(entries, now, {
      ceiling: this.settings.mercyCeiling,
      priorityCutoff: this.settings.mercyPriorityCutoff,
    });

    if (result.postponedCount === 0) {
      const due = result.dueToday.length;
      new Notice(
        `Incremental Reading: ${due} due, within ceiling ` +
          `(${this.settings.mercyCeiling}). Nothing to postpone.`,
      );
      return;
    }

    const events = await this.store.loadEvents();
    let lamport = nextLamport(events);
    const device = await this.store.getDeviceId();
    const newDue = now + 24 * 60 * 60 * 1000;

    for (const id of result.postponed) {
      const ev: IrEvent = {
        id: newEventId(),
        ts: now,
        lamport,
        device,
        kind: "mercy-postponed",
        target: id as ElementId,
        payload: { newDue },
      };
      await this.store.appendEvent(ev);
      lamport += 1;
    }
    await this.store.reconcile();

    new Notice(
      `Incremental Reading: postponed ${result.postponedCount} element` +
        `${result.postponedCount === 1 ? "" : "s"} to tomorrow ` +
        `(${result.dueToday.length} kept due today).`,
    );
  }

  /**
   * Build a fresh standalone-note path for an orphaned extract. Derived
   * from the first line of the verbatim extracted text plus an id tag so
   * two extracts with the same opening text don't collide. Lands inside
   * `extractFolder` if configured.
   */
  private promoteOrphanPath(el: IrElement): string {
    const folder = this.settings.extractFolder.trim().replace(/^\/+|\/+$/g, "");
    const firstLine = (el.text ?? "").split("\n")[0] ?? "";
    const safe = firstLine
      .replace(/[\\/:*?"<>|#^[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
    const tag = el.id.slice(0, 8);
    const stem = safe ? `${safe} (${tag})` : `orphan-${tag}`;
    return folder ? `${folder}/${stem}.md` : `${stem}.md`;
  }

  /**
   * Create the on-disk standalone note for a freshly-promoted orphan extract.
   * The new note carries the extract's verbatim text as body (the store
   * already had that text; this just makes it user-visible) plus the IR
   * frontmatter a normal extract gets, so it slots into the queue
   * indistinguishably from a user-created one.
   */
  private async materializePromotedNote(
    notePath: string,
    el: IrElement,
  ): Promise<void> {
    if (await this.app.vault.adapter.exists(notePath)) return;
    const folder = notePath.includes("/")
      ? notePath.slice(0, notePath.lastIndexOf("/"))
      : "";
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
      await this.app.vault.createFolder(folder);
    }
    const body = (el.text ?? "").trim() + "\n";
    const file = await this.app.vault.create(notePath, body);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[IR_KEYS.type] = "extract";
      fm[IR_KEYS.priority] = el.priority;
      writeTopicToFrontmatter(fm, newTopicState(this.settings));
    });
  }

  /**
   * Vault-delete handler. Routes the deletion through the pure
   * planSourceDeletion: source-tombstone, reparent children to grandparent,
   * delete source-element shadows, detach anchors, auto-promote
   * genuinely-rootless extracts to standalone notes. Filesystem work
   * (creating promoted notes) happens before the events are appended so the
   * store and disk land consistent; a write failure leaves the store
   * untouched.
   */
  private async handleSourceDeletion(deleted: TFile): Promise<void> {
    if (!this.store) return;
    try {
      const events = await this.store.loadEvents();
      const state = await this.store.load();
      const elements = Array.from(state.elements.values());
      const affected = elements.some(
        (e) =>
          e.notePath === deleted.path ||
          e.anchor?.sourcePath === deleted.path,
      );
      if (!affected) return;

      const newEvents = planSourceDeletion(
        elements,
        deleted.path,
        deleted.basename,
        Date.now(),
        nextLamport(events),
        await this.store.getDeviceId(),
        () => newEventId(),
        (el) => this.promoteOrphanPath(el),
        { autoPromoteRootless: true },
      );

      const byId = new Map(elements.map((e) => [e.id, e]));
      for (const ev of newEvents) {
        if (ev.kind === "promoted") {
          const path = (ev.payload as { notePath?: string }).notePath;
          const el = byId.get(ev.target);
          if (path && el) await this.materializePromotedNote(path, el);
        }
      }

      for (const ev of newEvents) await this.store.appendEvent(ev);
      await this.store.reconcile();

      const promoted = newEvents.filter((e) => e.kind === "promoted").length;
      const reparented = newEvents.filter((e) => e.kind === "reparented")
        .length;
      const parts: string[] = [];
      if (promoted)
        parts.push(`${promoted} extract${promoted === 1 ? "" : "s"} promoted`);
      if (reparented)
        parts.push(`${reparented} reparented`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      new Notice(
        `Incremental Reading: source "${deleted.basename}" removed${detail}.`,
      );
    } catch (e) {
      console.error("Incremental Reading: deletion handling failed", e);
    }
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
    await this.recordElement(result.file);
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
      await this.recordElement(target);
      new Notice(`Marked "${target.basename}" as an IR topic.`);
    }
  }

  /**
   * Mirror a just-created/marked note into the store as an `element-created`
   * event so it reaches the store-backed queue. Reuses the *pure*
   * `migrateNotes` transform on a single note: the element is built exactly
   * as a migration would build it, with the same path-derived id, so this is
   * idempotent and consistent with the rest of the store. Frontmatter (just
   * written by the ir-note helpers) is the dual-write fallback and is read
   * back atomically via `processFrontMatter`, which is reliable immediately
   * after creation where `metadataCache` may still be stale.
   */
  private async recordElement(file: TFile): Promise<void> {
    if (!this.store) return;
    try {
      let fm: Record<string, unknown> = {};
      await this.app.fileManager.processFrontMatter(file, (f) => {
        fm = { ...f };
      });
      const events = migrateNotes(
        [{ path: file.path, frontmatter: fm }],
        Date.now(),
      );
      for (const ev of events) {
        await this.store.appendEvent(ev);
      }
      await this.store.reconcile();
    } catch (e) {
      console.error("Incremental Reading: recording element failed", e);
      new Notice(
        "Incremental Reading: could not record the new element in the " +
          "store; it is still in the note. See the developer console.",
      );
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
   * - Reversible. The controller itself never touches note frontmatter; the
   *   migrated log is written alongside under `.ir/`, never in place of
   *   anything. Post-cutover the store drives the queue, but every review
   *   action still dual-writes the old `ir-` keys, so frontmatter remains a
   *   complete, hand-readable fallback.
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
    // clock-order, not conservative: on the live single-device plugin the
    // newest event must win, otherwise a "graded" event whose due moves
    // later than the migrated card is folded away and the item never
    // reschedules. This matches the Obsidian-Sync last-write-wins model the
    // log is designed around; the raw log is intact either way, so a
    // re-fold under another policy stays possible.
    const store = new IrStore(fs, { conflict: "clock-order" });

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
