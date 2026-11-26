import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PendingSelections,
  formatHeldSelectionConflictNotice,
  heldSelectionKey,
  isMultiSelectModifier,
  mergeWithLive,
  selectionSourcePath,
  type PdfHeldSelection,
} from "../src/ir/multi-select";

const pdfSel = (text: string, page = 1): PdfHeldSelection => ({
  kind: "pdf",
  pdfPath: "a.pdf",
  text,
  segments: [{ page, selection: [0, 0, 1, 1] }],
});

test("PendingSelections accumulates in order and dedupes identical spans", () => {
  const p = new PendingSelections();
  assert.equal(p.add(pdfSel("one")), true);
  assert.equal(p.add(pdfSel("two", 2)), true);
  assert.equal(p.add(pdfSel("one")), false);
  assert.equal(p.add(pdfSel("   ")), false);
  assert.equal(p.size, 2);
  assert.deepEqual(p.list().map((s) => s.text), ["one", "two"]);
  assert.equal(p.pdf("a.pdf").length, 2);
  assert.equal(p.pdf("b.pdf").length, 0);
  assert.equal(p.pop()?.text, "two");
  p.clear();
  assert.equal(p.size, 0);
});

test("body selections key on path + offsets, and single-source constraint rejects cross-note holds without dropping existing spans (#123)", () => {
  const p = new PendingSelections();
  assert.equal(p.sourcePath(), null);
  assert.deepEqual(
    p.tryAdd({ kind: "body", sourcePath: "n.md", text: "x", start: 0, end: 1 }),
    { ok: true },
  );
  assert.equal(p.sourcePath(), "n.md");
  assert.deepEqual(
    p.tryAdd({ kind: "body", sourcePath: "n.md", text: "x", start: 0, end: 1 }),
    { ok: false, reason: "duplicate" },
  );
  // Attempting to hold from another note or PDF is rejected without dropping n.md's held span
  assert.deepEqual(
    p.tryAdd({ kind: "body", sourcePath: "m.md", text: "y", start: 5, end: 6 }),
    { ok: false, reason: "source-mismatch", heldSourcePath: "n.md" },
  );
  assert.equal(p.add(pdfSel("from pdf")), false);
  assert.equal(p.size, 1);
  assert.equal(p.body("n.md").length, 1);
  assert.equal(p.conflictSourcePath("n.md"), null);
  assert.equal(p.conflictSourcePath("m.md"), "n.md");
  assert.match(
    formatHeldSelectionConflictNotice("n.md"),
    /n\.md.*Esc/i,
  );
  assert.match(
    formatHeldSelectionConflictNotice("slot:el_abc"),
    /review card.*Esc/i,
  );

  p.drop("n.md");
  assert.equal(p.size, 0);
  assert.equal(p.sourcePath(), null);
  // After clearing/dropping n.md, m.md can now be held
  assert.equal(
    p.add({ kind: "body", sourcePath: "m.md", text: "y", start: 5, end: 6 }),
    true,
  );
  assert.equal(
    selectionSourcePath({ kind: "body", sourcePath: "m.md", text: "y", start: 5, end: 6 }),
    "m.md",
  );
  assert.equal(
    heldSelectionKey({ kind: "body", sourcePath: "m.md", text: "y", start: 5, end: 6 }),
    "body:m.md:5-6",
  );
});

test("mergeWithLive appends the live span unless it duplicates a held one", () => {
  const held = [pdfSel("one")];
  assert.deepEqual(mergeWithLive(held, pdfSel("two")).map((s) => s.text), ["one", "two"]);
  assert.deepEqual(mergeWithLive(held, pdfSel("one")).map((s) => s.text), ["one"]);
  assert.deepEqual(mergeWithLive(held, null).map((s) => s.text), ["one"]);
  assert.deepEqual(mergeWithLive([], pdfSel(" ")), []);
});

test("isMultiSelectModifier accepts ctrl or meta", () => {
  assert.equal(isMultiSelectModifier({ ctrlKey: true, metaKey: false }), true);
  assert.equal(isMultiSelectModifier({ ctrlKey: false, metaKey: true }), true);
  assert.equal(isMultiSelectModifier({ ctrlKey: false, metaKey: false }), false);
});
