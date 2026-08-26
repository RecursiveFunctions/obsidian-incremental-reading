import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasOcclusion,
  maskPlan,
  nextRectNumber,
  normalizeDragRect,
  occlusionBodies,
  occlusionNoteStem,
  parseOcclusionBlock,
  parseOcclusionJson,
  serializeOcclusionBlock,
  type OcclusionSpec,
} from "../src/ir/occlusion";

const spec: OcclusionSpec = {
  image: "attachments/heart.png",
  mode: "hide-all",
  active: 2,
  rects: [
    { n: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: "aorta" },
    { n: 2, x: 0.5, y: 0.5, w: 0.2, h: 0.2 },
  ],
};

test("serialize → parse round-trips through a fenced block", () => {
  const block = serializeOcclusionBlock(spec);
  assert.ok(block.startsWith("```ir-occlusion\n"));
  assert.ok(hasOcclusion(`# Title\n\n${block}\n`));
  assert.equal(hasOcclusion("plain body"), false);
  const parsed = parseOcclusionBlock(`intro\n${block}\n`);
  assert.deepEqual(parsed, spec);
});

test("parseOcclusionJson rejects garbage and repairs a bad active", () => {
  assert.equal(parseOcclusionJson("not json"), null);
  assert.equal(parseOcclusionJson('{"image":"","rects":[]}'), null);
  assert.equal(
    parseOcclusionJson('{"image":"a.png","rects":[{"n":1,"x":2,"y":0,"w":"no","h":0.1}]}'),
    null,
  );
  const p = parseOcclusionJson(
    '{"image":"a.png","mode":"weird","active":9,"rects":[{"n":3,"x":1.5,"y":-1,"w":0.5,"h":0.5}]}',
  );
  assert.deepEqual(p, {
    image: "a.png",
    mode: "hide-all",
    active: 3,
    rects: [{ n: 3, x: 1, y: 0, w: 0.5, h: 0.5 }],
  });
});

test("occlusionBodies yields one body per rect with that rect active", () => {
  const bodies = occlusionBodies({ image: spec.image, mode: "hide-one", rects: spec.rects });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]!.n, 1);
  assert.equal(bodies[0]!.label, "aorta");
  assert.equal(parseOcclusionBlock(bodies[0]!.body)?.active, 1);
  assert.equal(parseOcclusionBlock(bodies[1]!.body)?.active, 2);
  assert.equal(parseOcclusionBlock(bodies[1]!.body)?.mode, "hide-one");
});

test("maskPlan: hide-all masks everything until reveal uncovers the active rect", () => {
  const hidden = maskPlan(spec, false);
  assert.deepEqual(hidden.map((m) => [m.masked, m.active]), [[true, false], [true, true]]);
  const shown = maskPlan(spec, true);
  assert.deepEqual(shown.map((m) => [m.masked, m.active]), [[true, false], [false, true]]);
  const hideOne = maskPlan({ ...spec, mode: "hide-one" }, false);
  assert.deepEqual(hideOne.map((m) => m.masked), [false, true]);
});

test("normalizeDragRect clamps, flips, and rejects slivers", () => {
  const flipped = normalizeDragRect(0.8, 0.9, 0.2, 0.3)!;
  assert.ok(Math.abs(flipped.x - 0.2) < 1e-9 && Math.abs(flipped.y - 0.3) < 1e-9);
  assert.ok(Math.abs(flipped.w - 0.6) < 1e-9 && Math.abs(flipped.h - 0.6) < 1e-9);
  assert.deepEqual(normalizeDragRect(-0.5, 0, 0.5, 2), { x: 0, y: 0, w: 0.5, h: 1 });
  assert.equal(normalizeDragRect(0.5, 0.5, 0.502, 0.9), null);
});

test("nextRectNumber and occlusionNoteStem", () => {
  assert.equal(nextRectNumber([]), 1);
  assert.equal(nextRectNumber(spec.rects), 3);
  assert.equal(occlusionNoteStem("img/Heart Anatomy.png", 2), "Occlusion Heart Anatomy 2");
});
