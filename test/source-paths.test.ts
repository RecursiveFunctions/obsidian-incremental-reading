import { test } from "node:test";
import assert from "node:assert/strict";
import {
  basenameOf,
  dirnameOf,
  inferPrefixRewrite,
  originalPathBySuffix,
  pathIsUnder,
  relocatedBySuffix,
  rewriteStoredPath,
  sourcePathRewrites,
  uniqueMovedPath,
} from "../src/ir/source-paths";
import { newElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

test("dirnameOf / basenameOf", () => {
  assert.equal(dirnameOf("Papers/a.md"), "Papers");
  assert.equal(basenameOf("Papers/a.md"), "a.md");
  assert.equal(dirnameOf("a.md"), "");
  assert.equal(basenameOf("a.md"), "a.md");
});

test("pathIsUnder", () => {
  assert.equal(pathIsUnder("Papers/a.md", "Papers"), true);
  assert.equal(pathIsUnder("Papers", "Papers"), true);
  assert.equal(pathIsUnder("Papers2/a.md", "Papers"), false);
});

test("rewriteStoredPath: file rename", () => {
  assert.equal(rewriteStoredPath("A/x.md", "A/x.md", "B/x.md"), "B/x.md");
  assert.equal(rewriteStoredPath("A/y.md", "A/x.md", "B/x.md"), null);
});

test("rewriteStoredPath: folder rename does not eat sibling prefixes", () => {
  assert.equal(
    rewriteStoredPath("Papers/a.md", "Papers", "Archive/Papers"),
    "Archive/Papers/a.md",
  );
  assert.equal(rewriteStoredPath("Papers2/a.md", "Papers", "Archive/Papers"), null);
  assert.equal(
    rewriteStoredPath("Papers/sub/b.md", "Papers", "Notes"),
    "Notes/sub/b.md",
  );
});

test("originalPathBySuffix: inverse of a folder-prefix move", () => {
  assert.equal(
    originalPathBySuffix("Archive/Papers/a.md", [
      "Papers/a.md",
      "Papers/b.md",
    ]),
    "Papers/a.md",
  );
  assert.equal(
    originalPathBySuffix("Archive/Papers/a.md", ["Elsewhere/a.md"]),
    null,
  );
  assert.equal(
    originalPathBySuffix("Archive/Papers/a.md", ["Papers/a.md", "a.md"]),
    "Papers/a.md",
  );
});

test("relocatedBySuffix: same relative path under a new parent", () => {
  assert.equal(
    relocatedBySuffix("Papers/a.md", ["Archive/Papers/a.md", "Archive/Papers/b.md"]),
    "Archive/Papers/a.md",
  );
  assert.equal(
    relocatedBySuffix("Papers/a.md", ["Elsewhere/a.md"]),
    null,
  );
});

test("uniqueMovedPath: one hit, or none if the name collides", () => {
  assert.equal(
    uniqueMovedPath("Old/a.md", ["New/a.md", "New/b.md"]),
    "New/a.md",
  );
  assert.equal(
    uniqueMovedPath("Old/a.md", ["New/a.md", "Other/a.md"]),
    null,
  );
  assert.equal(uniqueMovedPath("Old/a.md", ["Old/a.md"]), null);
});

test("inferPrefixRewrite: two unique matches under a new folder", () => {
  const missing = ["Papers/a.md", "Papers/b.md", "Papers/c.md"];
  const existing = ["Archive/Papers/a.md", "Archive/Papers/b.md", "Archive/Papers/c.md"];
  assert.deepEqual(inferPrefixRewrite(missing, existing), {
    from: "Papers",
    to: "Archive/Papers",
  });
});

test("inferPrefixRewrite: a single file move is not a folder move", () => {
  assert.equal(
    inferPrefixRewrite(["Papers/a.md"], ["Elsewhere/a.md"]),
    null,
  );
});

test("sourcePathRewrites: folder prefix updates notePath and anchor", () => {
  const topic = newElement({
    id: "el_t" as ElementId,
    type: "topic",
    priority: 50,
    parentId: null,
    notePath: "Papers/a.md",
    now: 0,
  });
  const extract = newElement({
    id: "el_e" as ElementId,
    type: "extract",
    priority: 50,
    parentId: "el_t" as ElementId,
    anchor: {
      sourcePath: "Papers/a.md",
      quote: { exact: "q", prefix: "", suffix: "" },
      position: { start: 0, end: 1 },
    },
    now: 0,
  });
  const got = sourcePathRewrites([topic, extract], "Papers", "Archive/Papers");
  assert.deepEqual(got, [
    {
      elementId: "el_e",
      oldPath: "Papers/a.md",
      newPath: "Archive/Papers/a.md",
    },
    {
      elementId: "el_t",
      oldPath: "Papers/a.md",
      newPath: "Archive/Papers/a.md",
    },
  ]);
});
