import assert from "node:assert/strict";
import { test } from "node:test";
import type { App, TFile, WorkspaceLeaf } from "obsidian";
import {
  PDF_VIEW_TYPE,
  openPdfAt,
  pickReusablePdfLeaf,
} from "../src/ir/pdf-view";

function makeLeaf(path: string | null): WorkspaceLeaf {
  const view = {
    getViewType: () => PDF_VIEW_TYPE,
    file: path ? ({ path, extension: "pdf" } as unknown as TFile) : undefined,
    containerEl: { focus() {} },
  };
  return {
    view,
    openFile: async (file: TFile, opts?: { eState?: { subpath?: string } }) => {
      view.file = file;
      opened.push({ path: file.path, subpath: opts?.eState?.subpath });
    },
  } as unknown as WorkspaceLeaf;
}

let opened: { path: string; subpath?: string }[] = [];

interface Harness {
  app: App;
  leaves: WorkspaceLeaf[];
  splits: string[];
  active: () => WorkspaceLeaf | null;
}

function makeApp(initial: WorkspaceLeaf[] = []): Harness {
  const leaves = [...initial];
  const splits: string[] = [];
  let active: WorkspaceLeaf | null = leaves[leaves.length - 1] ?? null;
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) =>
        ({ path, extension: "pdf" }) as unknown as TFile,
    },
    workspace: {
      getLeavesOfType: (type: string) =>
        type === PDF_VIEW_TYPE ? [...leaves] : [],
      openLinkText: async (link: string) => {
        splits.push(link);
        const leaf = makeLeaf(link.split("#")[0] ?? null);
        leaves.push(leaf);
        active = leaf;
      },
      get activeLeaf() {
        return active;
      },
      revealLeaf() {},
      setActiveLeaf(leaf: WorkspaceLeaf) {
        active = leaf;
      },
    },
  } as unknown as App;
  return { app, leaves, splits, active: () => active };
}

test("pickReusablePdfLeaf reuses only tracked, attached leaves", () => {
  const userLeaf = makeLeaf("X.pdf");
  const ownedLeaf = makeLeaf("A.pdf");
  const tracked = new WeakSet<WorkspaceLeaf>();
  tracked.add(ownedLeaf);

  assert.equal(pickReusablePdfLeaf([userLeaf], tracked), null);
  assert.equal(pickReusablePdfLeaf([userLeaf, ownedLeaf], tracked), ownedLeaf);
  // A tracked leaf that was detached is no longer in the leaf list.
  assert.equal(pickReusablePdfLeaf([userLeaf], tracked), null);
});

test("openPdfAt reuses the review-owned leaf for the next PDF", async () => {
  opened = [];
  const h = makeApp();
  await openPdfAt(h.app, "A.pdf", 1);
  assert.equal(h.splits.length, 1);
  const owned = h.leaves[0]!;

  await openPdfAt(h.app, "B.pdf", 2);
  assert.equal(h.splits.length, 1); // no second split
  assert.deepEqual(opened, [{ path: "B.pdf", subpath: "#page=2" }]);
  assert.equal(h.active(), owned);
  assert.equal(h.leaves.length, 1);
});

test("openPdfAt does not adopt a PDF the user opened manually", async () => {
  opened = [];
  const userLeaf = makeLeaf("X.pdf");
  const h = makeApp([userLeaf]);

  await openPdfAt(h.app, "A.pdf", 1);
  await openPdfAt(h.app, "B.pdf", 1);

  assert.equal((userLeaf.view as { file?: TFile }).file?.path, "X.pdf");
  assert.equal(h.leaves.length, 2);
  assert.deepEqual(opened, [{ path: "B.pdf", subpath: "#page=1" }]);
});
