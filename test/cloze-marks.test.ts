import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTextQuoteAnchor,
  clozeRangesInBody,
  itemSourcePath,
  packSourceMarksPreferringCloze,
  reviewSourceSplices,
} from "../src/ir/cloze-marks";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

function el(p: Omit<Partial<IrElement>, "id"> & { id: string }): IrElement {
  const { id, ...rest } = p;
  return {
    type: "item",
    priority: 50,
    parentId: "el_topic" as ElementId,
    dismissed: false,
    created: 0,
    text: "",
    anchorState: "ok",
    ...rest,
    id: id as ElementId,
  };
}

test("itemSourcePath: uses markdown parent notePath", () => {
  const topic = el({
    id: "el_topic",
    type: "topic",
    parentId: null,
    notePath: "Notes/T.md",
  });
  const item = el({ id: "el_item", parentId: "el_topic" as ElementId });
  const byId = new Map<string, IrElement>([
    [topic.id, topic],
    [item.id, item],
  ]);
  assert.equal(itemSourcePath(item, byId), "Notes/T.md");
});

test("clozeRangesInBody: stored anchor wins", () => {
  const body = "The quick brown fox.";
  const item = el({
    id: "el_item",
    text: "The {{c1::quick}} brown fox.",
    anchor: {
      sourcePath: "Notes/T.md",
      quote: { exact: "quick", prefix: "The ", suffix: " brown" },
      position: { start: 4, end: 9 },
    },
  });
  const byId = new Map<string, IrElement>([[item.id, item]]);
  const ranges = clozeRangesInBody([item], body, "Notes/T.md", byId);
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0], {
    start: 4,
    end: 9,
    text: "quick",
    kind: "cloze",
  });
});

test("clozeRangesInBody: unique answer fallback for items without anchors", () => {
  const topic = el({
    id: "el_topic",
    type: "topic",
    parentId: null,
    notePath: "Notes/T.md",
  });
  const item = el({
    id: "el_item",
    text: "context {{c1::brown fox}} more",
  });
  const byId = new Map<string, IrElement>([
    [topic.id, topic],
    [item.id, item],
  ]);
  const ranges = clozeRangesInBody(
    [item],
    "The brown fox jumps.",
    "Notes/T.md",
    byId,
  );
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0]?.kind, "cloze");
  assert.equal(ranges[0]?.text, "brown fox");
  assert.equal(
    "The brown fox jumps.".slice(ranges[0]!.start, ranges[0]!.end),
    "brown fox",
  );
});

test("clozeRangesInBody: skips ambiguous answers", () => {
  const topic = el({
    id: "el_topic",
    type: "topic",
    parentId: null,
    notePath: "Notes/T.md",
  });
  const item = el({ id: "el_item", text: "{{c1::the}}" });
  const byId = new Map<string, IrElement>([
    [topic.id, topic],
    [item.id, item],
  ]);
  const ranges = clozeRangesInBody(
    [item],
    "the cat and the mat",
    "Notes/T.md",
    byId,
  );
  assert.equal(ranges.length, 0);
});

test("packSourceMarksPreferringCloze: cloze keeps the overlap, extract keeps the rest", () => {
  const packed = packSourceMarksPreferringCloze([
    { start: 0, end: 20, text: "extract", kind: "extract" },
    { start: 5, end: 10, text: "cloze", kind: "cloze" },
  ]);
  const clozes = packed.filter((r) => r.kind === "cloze");
  const extracts = packed.filter((r) => r.kind === "extract");
  assert.equal(clozes.length, 1);
  assert.deepEqual(clozes[0], {
    start: 5,
    end: 10,
    text: "cloze",
    kind: "cloze",
  });
  assert.deepEqual(
    extracts.map((e) => [e.start, e.end]),
    [
      [0, 5],
      [10, 20],
    ],
  );
});

test("buildTextQuoteAnchor: records exact slice plus prefix/suffix", () => {
  const a = buildTextQuoteAnchor("Notes/T.md", "The quick brown fox", 4, 9, 4);
  assert.equal(a.sourcePath, "Notes/T.md");
  assert.deepEqual(a.position, { start: 4, end: 9 });
  assert.deepEqual(a.quote, {
    exact: "quick",
    prefix: "The ",
    suffix: " bro",
  });
});

test("reviewSourceSplices: cloze inside focused extract keeps both classes for scroll", () => {
  const splices = reviewSourceSplices(
    [
      { start: 0, end: 20, text: "extract", kind: "extract" },
      { start: 5, end: 10, text: "cloze", kind: "cloze" },
    ],
    { start: 0, end: 20 },
  );
  assert.deepEqual(
    splices.map((s) => [s.start, s.end, s.cls]),
    [
      [5, 10, "ir-cloze-source"],
      [0, 5, "ir-extract-highlight"],
      [10, 20, "ir-extract-highlight"],
    ],
  );
});

test("reviewSourceSplices: cloze that ate the focused span still gets highlight", () => {
  const splices = reviewSourceSplices(
    [
      { start: 5, end: 10, text: "cloze", kind: "cloze" },
      { start: 5, end: 10, text: "extract", kind: "extract" },
    ],
    { start: 5, end: 10 },
  );
  assert.equal(splices.length, 1);
  assert.equal(splices[0].cls, "ir-cloze-source ir-extract-highlight");
});
