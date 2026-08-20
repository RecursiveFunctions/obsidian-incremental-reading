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
  stripFrontmatter,
} from "./frontmatter-body";
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
  setSelection(start: number, end: number): void;
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
): Promise<ReviewLiveEditor | null> {
  const hostEl = parent.createDiv({ cls: "ir-review-live-editor" });
  let leaf: WorkspaceLeaf | null = null;
  try {
    const split = new SplitCtor(app.workspace, "vertical");
    split.getRoot = () => reviewLeaf.getRoot();
    split.getContainer = () => reviewLeaf.getContainer();
    hostEl.appendChild(split.containerEl);
    leaf = app.workspace.createLeafInParent(split, 0);
    await leaf.openFile(file, {
      state: reviewEditorState(kind),
      active: false,
    });
    const vs = leaf.getViewState();
    const prev =
      vs.state && typeof vs.state === "object"
        ? (vs.state as Record<string, unknown>)
        : {};
    if (!isReviewEditorState(prev, kind)) {
      await leaf.setViewState({
        ...vs,
        state: reviewEditorState(kind, prev),
      });
    }
    hostEl.toggleClass("ir-review-live-editor--source", kind === "source");
    const mv = markdownViewOf(leaf);
    if (!mv) {
      leaf.detach();
      hostEl.detach();
      return null;
    }
    // Keep the review tab as the workspace leaf; only the inner editor
    // takes DOM focus so Space/Alt+X stay on the review keymap.
    app.workspace.setActiveLeaf(reviewLeaf, { focus: false });
    mv.editor.focus();
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
    setSelection: (start, end) => {
      const mv = markdownViewOf(opened);
      if (!mv) return;
      const full = mv.editor.getValue();
      const { from, to } = fullOffsetsFromBodyOffsets(full, start, end);
      mv.editor.setSelection(
        mv.editor.offsetToPos(from),
        mv.editor.offsetToPos(to),
      );
      mv.editor.focus();
    },
    save: async () => {
      const mv = markdownViewOf(opened);
      if (mv) await mv.save();
    },
    setKind: async (nextKind) => {
      const vs = opened.getViewState();
      const prev =
        vs.state && typeof vs.state === "object"
          ? (vs.state as Record<string, unknown>)
          : {};
      hostEl.toggleClass("ir-review-live-editor--source", nextKind === "source");
      if (isReviewEditorState(prev, nextKind)) {
        markdownViewOf(opened)?.editor.focus();
        return;
      }
      await opened.setViewState({
        ...vs,
        state: reviewEditorState(nextKind, prev),
      });
      app.workspace.setActiveLeaf(reviewLeaf, { focus: false });
      markdownViewOf(opened)?.editor.focus();
    },
    destroy: () => {
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
