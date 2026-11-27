import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diffTypedAnswer,
  extractTypedClozes,
  gradeMcqSelection,
  gradeOrderedSequence,
  hasInteractiveQuiz,
  hasMcqBlock,
  hasOrderBlock,
  hasTypedCloze,
  moveOrderItem,
  parseMcqBlock,
  parseOrderBlock,
  scrambleOrderItems,
  shuffleMcqOptions,
  transformTypedClozes,
  wrapTypedCloze,
} from "../src/ir/interactive-items";
import {
  occlusionBodies,
  parseOcclusionBlock,
  pointInPolygon,
  polygonMaskPlan,
  serializeOcclusionBlock,
  type OcclusionPolygon,
} from "../src/ir/occlusion";

test("Spell-Pad typed cloze ({{c1:=answer::hint}}) wraps, extracts, transforms, and diffs character-by-character", () => {
  const cardText = `The neurotransmitter at the NMJ is ${wrapTypedCloze("acetylcholine", 1, "ACh")}.`;
  assert.equal(cardText, "The neurotransmitter at the NMJ is {{c1:=acetylcholine::ACh}}.");
  assert.equal(hasTypedCloze(cardText), true);
  assert.equal(hasInteractiveQuiz(cardText), true);

  const groups = extractTypedClozes(cardText);
  assert.deepEqual(groups, [{ n: 1, answer: "acetylcholine", hint: "ACh" }]);

  const masked = transformTypedClozes(cardText, ({ hint }) => `[type:${hint ?? ""}]`);
  assert.equal(masked, "The neurotransmitter at the NMJ is [type:ACh].");

  const exact = diffTypedAnswer("acetylcholine", "acetylcholine");
  assert.equal(exact.exactMatch, true);
  assert.equal(exact.suggestedSmGrade, 5);

  const caseOnly = diffTypedAnswer("Acetylcholine", "acetylcholine");
  assert.equal(caseOnly.exactMatch, false);
  assert.equal(caseOnly.normalizedMatch, true);
  assert.equal(caseOnly.suggestedSmGrade, 4);

  const minorTypo = diffTypedAnswer("acetylcholine", "acetylcoline");
  assert.equal(minorTypo.exactMatch, false);
  assert.ok(minorTypo.accuracy >= 0.85);
  assert.equal(minorTypo.suggestedSmGrade, 3);
  assert.ok(minorTypo.segments.some((s) => s.kind === "missing" && s.text.includes("h")));

  const wrong = diffTypedAnswer("acetylcholine", "dopamine");
  assert.equal(wrong.suggestedSmGrade, 1);
});

test("ir-mcq block parses Markdown choices, shuffles deterministically, and grades single/multi-correct", () => {
  const md = [
    "```ir-mcq",
    "Which ion triggers synaptic vesicle fusion?",
    "* Ca2+",
    "- Na+",
    "- K+",
    "- Cl-",
    "```",
  ].join("\n");

  assert.equal(hasMcqBlock(md), true);
  assert.equal(hasInteractiveQuiz(md), true);
  const spec = parseMcqBlock(md);
  assert.ok(spec !== null);
  assert.equal(spec.prompt, "Which ion triggers synaptic vesicle fusion?");
  assert.equal(spec.options.length, 4);
  assert.equal(spec.options[0]!.correct, true);

  const shufA = shuffleMcqOptions(spec.options, 101);
  const shufB = shuffleMcqOptions(spec.options, 101);
  assert.deepEqual(shufA, shufB);

  const rightIdx = shufA.findIndex((o) => o.correct);
  const wrongIdx = shufA.findIndex((o) => !o.correct);
  assert.equal(gradeMcqSelection(shufA, [rightIdx]).correct, true);
  assert.equal(gradeMcqSelection(shufA, [rightIdx]).suggestedSmGrade, 4);
  assert.equal(gradeMcqSelection(shufA, [wrongIdx]).correct, false);
  assert.equal(gradeMcqSelection(shufA, [wrongIdx]).suggestedSmGrade, 1);
});

test("ir-order block parses numbered sequence, scrambles to a derangement, moves items, and scores order", () => {
  const md = [
    "```ir-order",
    "Order the stages of mitosis:",
    "1. Prophase",
    "2. Metaphase",
    "3. Anaphase",
    "4. Telophase",
    "```",
  ].join("\n");

  assert.equal(hasOrderBlock(md), true);
  const spec = parseOrderBlock(md);
  assert.ok(spec !== null);
  assert.equal(spec.prompt, "Order the stages of mitosis:");
  assert.deepEqual(spec.items, ["Prophase", "Metaphase", "Anaphase", "Telophase"]);

  const scrambled = scrambleOrderItems(spec.items, 7);
  assert.equal(scrambled.length, 4);
  assert.notDeepEqual(scrambled, spec.items);

  const moved = moveOrderItem(["B", "A", "C"], 1, 0);
  assert.deepEqual(moved, ["A", "B", "C"]);

  const perfect = gradeOrderedSequence(spec.items, [...spec.items]);
  assert.equal(perfect.exactMatch, true);
  assert.equal(perfect.accuracy, 1);
  assert.equal(perfect.suggestedSmGrade, 4);

  const reversed = gradeOrderedSequence(spec.items, [...spec.items].reverse());
  assert.equal(reversed.exactMatch, false);
  assert.equal(reversed.suggestedSmGrade, 1);
});

test("Polygon image occlusion (THitEditor) serializes, parses, hit-tests vertices, and generates sibling bodies", () => {
  const poly1: OcclusionPolygon = {
    n: 1,
    points: [
      [0.1, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
      [0.1, 0.5],
    ],
    label: "Left ventricle",
  };
  const poly2: OcclusionPolygon = {
    n: 2,
    points: [
      [0.6, 0.2],
      [0.9, 0.2],
      [0.75, 0.8],
    ],
    label: "Aortic arch",
  };

  assert.equal(pointInPolygon([0.3, 0.3], poly1.points), true);
  assert.equal(pointInPolygon([0.8, 0.8], poly1.points), false);

  const block = serializeOcclusionBlock({
    image: "anatomy/heart.png",
    mode: "hide-all",
    active: 2,
    rects: [],
    polygons: [poly1, poly2],
  });
  const parsed = parseOcclusionBlock(block);
  assert.ok(parsed !== null);
  assert.equal(parsed.polygons?.length, 2);
  assert.equal(parsed.active, 2);

  const hiddenPlan = polygonMaskPlan(parsed, false);
  assert.equal(hiddenPlan[0]!.masked, true);
  assert.equal(hiddenPlan[1]!.masked, true);
  assert.equal(hiddenPlan[1]!.active, true);

  const revealedPlan = polygonMaskPlan(parsed, true);
  assert.equal(revealedPlan[0]!.masked, true); // hide-all keeps non-active masked
  assert.equal(revealedPlan[1]!.masked, false); // active polygon uncovered

  const siblings = occlusionBodies({
    image: "anatomy/heart.png",
    mode: "hide-all",
    rects: [],
    polygons: [poly1, poly2],
  });
  assert.equal(siblings.length, 2);
  assert.equal(siblings[0]!.label, "Left ventricle");
  assert.equal(siblings[1]!.label, "Aortic arch");
});
