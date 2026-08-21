/**
 * In-card Live Preview for IR review.
 *
 * The review pane is an ItemView, so Edit used to swap rendered markdown for a
 * raw textarea (source). Clicking the card felt like jumping to another view.
 * Live Preview (`source: false`) by default. **Source** uses the same nested
 * editor in raw markdown (`source: true`). Store-only extracts and mobile
 * keep the textarea.
 *
 * The nested leaf lives in a detached WorkspaceSplit (same idea as Hover
 * Editor): it is not a second tab. Park the host across `renderCard` empties
 * so we do not remount pdf.js-style and drop the cursor.
 */

import {
  App,
  MarkdownView,
  TFile,
  Workspace,
  WorkspaceLeaf,
  WorkspaceSplit,
} from "obsidian";
import {
  bodyOffsetsFromFullOffsets,
  fullOffsetsFromBodyOffsets,
  bodyOffsetFromFullOffset,
  stripFrontmatter,
} from "./frontmatter-body";
import {
  applyScrollProgress,
  readScrollProgress,
} from "./reading-progress";
import {
  isReviewEditorState,
  reviewEditorState,
  type ReviewEditorKind,
} from "./review-live-preview";

type SplitDom = WorkspaceSplit & {
  containerEl: HTMLElement;
};

const SplitCtor = WorkspaceSplit as unknown as {
  new (workspace: Workspace, dir: string): SplitDom;
};

export interface ReviewLiveEditor {
  filePath: string;
  hostEl: HTMLElement;
  getBody(): string;
  getSelection(): { start: number; end: number; text: string } | null;
  /** Collapsed caret as a body offset (frontmatter stripped). */
  getCaretOffset(): number;
  getScroller(): HTMLElement | null;
  getScrollProgress(): number;
  setScrollProgress(progress: number): void;
  setSelection(start: number, end: number, opts?: { scroll?: boolean }): void;
  save(): Promise<void>;
  setKind(kind: ReviewEditorKind): Promise<void>;
  destroy(): void;
  contains(node: Node | null): boolean;
}

export async function mountReviewLiveEditor(
  app: App,
  file: TFile,
  reviewLeaf: WorkspaceLeaf,
  parent: HTMLElement,
  kind: ReviewEditorKind = "live",
  onEscape?: () => void,
): Promise<ReviewLiveEditor | null> {
  const hostEl = parent.createDiv({ cls: "ir-review-live-editor" });
  let leaf: WorkspaceLeaf | null = null;
  const escapeListener = (evt: KeyboardEvent): void => {
    if (evt.key !== "Escape" || !onEscape) return;
    // Capture before Obsidian/CM treat Escape as "close leaf".
    evt.preventDefault();
    evt.stopPropagation();
    onEscape();
  };
  if (onEscape) {
    hostEl.addEventListener("keydown", escapeListener, true);
  }
  try {
    const split = new SplitCtor(app.workspace, "vertical");
    split.getRoot = () => reviewLeaf.getRoot();
    split.getContainer = () => reviewLeaf.getContainer();
    hostEl.appendChild(split.containerEl);
    leaf = app.workspace.createLeafInParent(split, 0);
    // Load the file first with no custom state. Passing `{ mode, source }`
    // without `file` made MarkdownView open an empty buffer — the card
    // went blank on click-to-edit.
    await leaf.openFile(file, { active: false });
    if (leaf.isDeferred) await leaf.loadIfDeferred();
    await applyEditorKind(leaf, file.path, kind);
    hostEl.toggleClass("ir-review-live-editor--source", kind === "source");
    const mv = markdownViewOf(leaf);
    if (!mv) {
      leaf.detach();
      hostEl.detach();
      return null;
    }
    if (!mv.editor.getValue()) {
      mv.setViewData(await app.vault.read(file), false);
    }
    // Keep the review tab as the workspace leaf; only the inner editor
    // takes DOM focus so Space/Alt+X stay on the review keymap.
    app.workspace.setActiveLeaf(reviewLeaf, { focus: false });
    leaf.onResize();
    mv.editor.focus();
    requestAnimationFrame(() => leaf?.onResize());
  } catch (e) {
    console.error("Incremental Reading: review editor failed", e);
    leaf?.detach();
    hostEl.detach();
    return null;
  }

  const opened = leaf;
  return {
    filePath: file.path,
    hostEl,
    getBody: () => {
      const mv = markdownViewOf(opened);
      if (!mv) return "";
      return stripFrontmatter(mv.editor.getValue());
    },
    getSelection: () => {
      const mv = markdownViewOf(opened);
      if (!mv || !mv.editor.somethingSelected()) return null;
      const full = mv.editor.getValue();
      const from = mv.editor.posToOffset(mv.editor.getCursor("from"));
      const to = mv.editor.posToOffset(mv.editor.getCursor("to"));
      const mapped = bodyOffsetsFromFullOffsets(full, from, to);
      if (!mapped) return null;
      return {
        start: mapped.start,
        end: mapped.end,
        text: stripFrontmatter(full).slice(mapped.start, mapped.end),
      };
    },
    getCaretOffset: () => {
      const mv = markdownViewOf(opened);
      if (!mv) return 0;
      const full = mv.editor.getValue();
      const off = mv.editor.posToOffset(mv.editor.getCursor("head"));
      return bodyOffsetFromFullOffset(full, off);
    },
    getScroller: () =>
      hostEl.querySelector<HTMLElement>(".cm-scroller"),
    getScrollProgress: () => {
      const el = hostEl.querySelector<HTMLElement>(".cm-scroller");
      return el ? readScrollProgress(el) : 0;
    },
    setScrollProgress: (progress) => {
      const el = hostEl.querySelector<HTMLElement>(".cm-scroller");
      if (el) applyScrollProgress(el, progress);
    },
    setSelection: (start, end, opts) => {
      const mv = markdownViewOf(opened);
      if (!mv) return;
      const full = mv.editor.getValue();
      const { from, to } = fullOffsetsFromBodyOffsets(full, start, end);
      const fromPos = mv.editor.offsetToPos(from);
      const toPos = mv.editor.offsetToPos(to);
      mv.editor.setSelection(fromPos, toPos);
      if (opts?.scroll !== false) {
        mv.editor.scrollIntoView({ from: fromPos, to: toPos }, true);
      }
      mv.editor.focus();
    },
    save: async () => {
      const mv = markdownViewOf(opened);
      if (mv) await mv.save();
    },
    setKind: async (nextKind) => {
      hostEl.toggleClass("ir-review-live-editor--source", nextKind === "source");
      await applyEditorKind(opened, file.path, nextKind);
      app.workspace.setActiveLeaf(reviewLeaf, { focus: false });
      opened.onResize();
      markdownViewOf(opened)?.editor.focus();
    },
    destroy: () => {
      if (onEscape) {
        hostEl.removeEventListener("keydown", escapeListener, true);
      }
      opened.detach();
      hostEl.detach();
    },
    contains: (node) => !!node && hostEl.contains(node),
  };
}

function markdownViewOf(leaf: WorkspaceLeaf): MarkdownView | null {
  const view = leaf.view;
  return view instanceof MarkdownView ? view : null;
}

async function applyEditorKind(
  leaf: WorkspaceLeaf,
  filePath: string,
  kind: ReviewEditorKind,
): Promise<void> {
  const vs = leaf.getViewState();
  const prev =
    vs.state && typeof vs.state === "object"
      ? (vs.state as Record<string, unknown>)
      : {};
  if (isReviewEditorState(prev, kind) && prev.file === filePath) return;
  await leaf.setViewState({
    ...vs,
    state: reviewEditorState(kind, { ...prev, file: filePath }),
  });
  if (leaf.isDeferred) await leaf.loadIfDeferred();
}
