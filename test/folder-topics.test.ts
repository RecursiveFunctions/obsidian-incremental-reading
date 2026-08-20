import { test } from "node:test";
import assert from "node:assert/strict";
import {
  folderTopicCandidates,
  isPathInFolder,
} from "../src/ir/folder-topics";

test("isPathInFolder: vault root contains everything", () => {
  assert.equal(isPathInFolder("a.md", ""), true);
  assert.equal(isPathInFolder("a.md", "/"), true);
});

test("isPathInFolder: prefix, not a sibling with the same start", () => {
  assert.equal(isPathInFolder("Notes/a.md", "Notes"), true);
  assert.equal(isPathInFolder("Notes/sub/b.md", "Notes"), true);
  assert.equal(isPathInFolder("Notes.md", "Notes"), false);
  assert.equal(isPathInFolder("Notebook/a.md", "Notes"), false);
});

test("folderTopicCandidates: md + pdf, skip already-IR, ignore other types", () => {
  const files = [
    { path: "Papers/one.md", extension: "md" },
    { path: "Papers/two.pdf", extension: "pdf" },
    { path: "Papers/skip.md", extension: "md" },
    { path: "Papers/img.png", extension: "png" },
    { path: "Other/out.md", extension: "md" },
  ];
  const got = folderTopicCandidates(files, "Papers", new Set(["Papers/skip.md"]));
  assert.deepEqual(
    got.map((f) => f.path).sort(),
    ["Papers/one.md", "Papers/two.pdf"],
  );
});
