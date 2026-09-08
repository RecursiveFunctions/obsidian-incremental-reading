/**
 * Keyboard cheat sheet and orientation panel.
 *
 * The plugin ships about thirty commands and twenty-five default bindings,
 * and until now had no in-app surface that named any of them: a new user's
 * only path was the empty review pane, which says "Alt+T then Alt+R" and
 * stops. This is the missing first-run answer to "what can I press".
 *
 * Side panel, not a modal (UI commitment #6), so it can stay open next to
 * the review pane while you learn the keys.
 *
 * Two sources of truth, deliberately different:
 *
 * - **Commands** come from the plugin's own registration list, so a command
 *   added later shows up here without anyone remembering to update a doc.
 * - **In-review keys** are hardcoded below because they are not commands at
 *   all; they live in the review view's `keydown` handler. Change them in
 *   `src/review-view.ts` and change them here.
 */

import { ItemView, WorkspaceLeaf, type Command } from "obsidian";

import { formatHotkey } from "./ir/hotkeys";

export const IR_HELP_VIEW_TYPE = "ir-help-view";

/** Mirrors the review pane's keydown handler in `src/review-view.ts`. */
const REVIEW_KEYS: Array<[string, string]> = [
  ["Space", "Reading: next card. Cloze: reveal, then grade."],
  ["1 / 2 / 3 / 4", "Again / Hard / Good / Easy, once the answer is shown."],
  ["Enter", "Reading: next card."],
  ["Ctrl+Enter", "Reading: next card, even while editing the body."],
  ["[", "Back to the previous card in this pass."],
  ["L", "Reading: later today. Reschedules without counting a review."],
  ["D", "Dismiss the current element."],
  ["Alt+X", "Extract the selection as a child element."],
  ["Alt+Z", "Cloze the selection into a separate item."],
  ["Esc", "Leave the review tab."],
];

/** Mirrors `treeKeyCommand` in `src/ir/tree-nav.ts`. */
const TREE_KEYS: Array<[string, string]> = [
  ["J / K, arrows", "Move the focus up and down the tree."],
  ["Space", "Expand or collapse the focused element."],
  ["Enter", "Start a review pass at the focused element."],
  ["O", "Open the focused element's note."],
  ["P", "Edit priority inline."],
  ["D", "Dismiss or restore."],
  ["M", "Postpone."],
  ["X", "Pick the focused element (or the selection) up to move it."],
  ["V", "Drop what you picked up onto the focused element."],
  ["Esc", "Cancel a move."],
];

/** Concepts the UI assumes you already know. */
const CONCEPTS: Array<[string, string]> = [
  [
    "Topic",
    "Something you read. Topics advance through a reading schedule; they are not graded.",
  ],
  [
    "Extract",
    "A span pulled out of a topic (or another extract). Keeps a link back to where it came from.",
  ],
  [
    "Item",
    "A card you grade: a cloze, or an image occlusion. Scheduled by FSRS.",
  ],
  [
    "Priority",
    "0 to 100, and lower means more important. Priority 0 floats to the top of the queue.",
  ],
  [
    "Later today",
    "Pushes a reading element back a few hours. Not a review, so it does not touch the schedule's growth.",
  ],
  [
    "Postpone (mercy)",
    "Bulk-pushes overdue elements out when the queue has run away from you. Also not a review.",
  ],
  [
    "Dismiss",
    "Takes an element out of the queue but keeps it and its children in the tree. Reversible.",
  ],
];

export class IrHelpView extends ItemView {
  constructor(
    leaf: WorkspaceLeaf,
    private readonly commands: ReadonlyArray<Command>,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return IR_HELP_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "IR help";
  }

  getIcon(): string {
    return "keyboard";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {}

  private render(): void {
    const c = this.contentEl;
    c.empty();
    c.addClass("ir-help-view");

    c.createEl("h4", { text: "Incremental Reading" });
    c.createEl("p", {
      cls: "ir-help-lede",
      text: "Mark a note as a topic, read it in the review pane, pull extracts out of it as you go, and turn the parts worth remembering into cloze items.",
    });

    this.section(c, "In a review session", REVIEW_KEYS, "kbd");
    this.section(c, "In the element tree", TREE_KEYS, "kbd");
    this.section(
      c,
      "Commands",
      this.commands.map((cmd): [string, string] => [
        formatHotkey(cmd),
        cmd.name,
      ]),
      "kbd",
    );
    c.createDiv({
      cls: "ir-help-note",
      text: "Bindings shown are the defaults. Rebind any of them in Settings, Hotkeys, searching for Incremental Reading.",
    });
    this.section(c, "Vocabulary", CONCEPTS, "term");
  }

  private section(
    parent: HTMLElement,
    title: string,
    rows: Array<[string, string]>,
    kind: "kbd" | "term",
  ): void {
    if (rows.length === 0) return;
    parent.createEl("h5", { cls: "ir-help-section-title", text: title });
    const list = parent.createEl("dl", { cls: `ir-help-list ir-help-list--${kind}` });
    for (const [left, right] of rows) {
      const dt = list.createEl("dt", { cls: "ir-help-key" });
      if (kind === "kbd" && left) dt.createEl("kbd", { text: left });
      else dt.setText(left || "—");
      list.createEl("dd", { cls: "ir-help-desc", text: right });
    }
  }
}
