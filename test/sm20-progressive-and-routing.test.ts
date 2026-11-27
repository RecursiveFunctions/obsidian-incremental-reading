import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveChildConceptRouting,
  upsertConceptGroup,
  createEmptyConceptRegistry,
} from "../src/ir/concepts-references";
import { finalizeDraftPolygon } from "../src/ir/occlusion";
import {
  chopReadingTextAfterOffset,
  chopReadingTextBeforeOffset,
  computeSm20SincHeatmap20x20,
} from "../src/ir/sm20-reading-tools";
import { createEmptySm20Matrix } from "../src/ir/sm20-matrix";

test("resolveChildConceptRouting applies ConceptGroup targetFolder, defaultPriority, and item/topic templates", () => {
  let reg = createEmptyConceptRegistry();
  reg = upsertConceptGroup(reg, {
    id: "concept_pharma",
    name: "Pharmacology",
    targetFolder: "Vault/Pharmacology/Cards",
    defaultPriority: 14,
    topicTemplate: "> Extract\n{{content}}",
    itemTemplate: "### Pharmacology Q\n{{content}}",
    updatedAt: 1000,
  });

  const itemRouted = resolveChildConceptRouting(
    { ir_concept: "Pharmacology" },
    reg,
    "item",
    "Beta-1 blockers reduce {{c1::heart rate}}.",
    "DefaultExtracts",
    33,
  );
  assert.equal(itemRouted.folder, "Vault/Pharmacology/Cards");
  assert.equal(itemRouted.priority, 14);
  assert.equal(itemRouted.body, "### Pharmacology Q\nBeta-1 blockers reduce {{c1::heart rate}}.");

  const extractRouted = resolveChildConceptRouting(
    { ir_concept: "Pharmacology" },
    reg,
    "extract",
    "ACE inhibitors block angiotensin II formation.",
    "DefaultExtracts",
    33,
  );
  assert.equal(extractRouted.folder, "Vault/Pharmacology/Cards");
  assert.equal(extractRouted.body, "> Extract\nACE inhibitors block angiotensin II formation.");
});

test("chopReadingTextBeforeOffset & chopReadingTextAfterOffset (0x00fa1240) preserve YAML frontmatter, preserve #SuperMemo Reference:, and guard anchored spans", () => {
  const fullNote = [
    "---",
    "ir-type: topic",
    "ir-priority: 20",
    "---",
    "",
    "Introductory paragraph already read.",
    "",
    "Core mechanism to keep studying next time.",
    "",
    "#SuperMemo Reference:",
    "#Title: Cellular Physiology",
    "#Author: Boron & Boulpaep",
  ].join("\n");

  // Chop before "Core mechanism" (offset 38 in stripped body)
  const choppedBefore = chopReadingTextBeforeOffset(fullNote, 38);
  assert.equal(choppedBefore.ok, true);
  assert.match(choppedBefore.updatedFile!, /^---\nir-type: topic/);
  assert.doesNotMatch(choppedBefore.updatedFile!, /Introductory paragraph/);
  assert.match(choppedBefore.updatedFile!, /Core mechanism to keep studying next time\./);
  assert.match(choppedBefore.updatedFile!, /#SuperMemo Reference:\n#Title: Cellular Physiology/);

  // Chop after "Introductory paragraph already read." (offset 36 in stripped body) STILL keeps #SuperMemo Reference:!
  const choppedAfter = chopReadingTextAfterOffset(fullNote, 36);
  assert.equal(choppedAfter.ok, true);
  assert.match(choppedAfter.updatedFile!, /Introductory paragraph already read\./);
  assert.doesNotMatch(choppedAfter.updatedFile!, /Core mechanism/);
  assert.match(choppedAfter.updatedFile!, /#Author: Boron & Boulpaep/);

  // Refuses if chopping would wipe everything except #SuperMemo Reference:
  const wipeAttempt = chopReadingTextBeforeOffset(fullNote, 82);
  assert.equal(wipeAttempt.ok, false);

  // Guards anchored child extract spans inside the chopped region
  const guarded = chopReadingTextBeforeOffset(fullNote, 38, [{ start: 5, end: 20 }]);
  assert.equal(guarded.ok, false);
  assert.match(guarded.reason ?? "", /anchored/i);
});

test("computeSm20SincHeatmap20x20 builds 20x20 Difficulty x Stability SInc grid with monotonic bounds", () => {
  const matrix = createEmptySm20Matrix();
  const hm = computeSm20SincHeatmap20x20(matrix, 0.9);
  assert.equal(hm.rows.length, 20);
  assert.equal(hm.rows[0]!.length, 20);
  assert.ok(hm.maxSinc >= hm.minSinc);
  // Easier items (row 0, D1) have higher SInc than hardest items (row 19, D20) at same stability
  assert.ok(hm.rows[0]![2]! > hm.rows[19]![2]!);
});

test("finalizeDraftPolygon clamps vertices, rejects <3 or degenerate collinear points, and assigns next n", () => {
  assert.equal(finalizeDraftPolygon([[0.1, 0.1], [0.2, 0.2]], [], []), null);
  // Collinear points rejected
  assert.equal(
    finalizeDraftPolygon(
      [
        [0.1, 0.1],
        [0.3, 0.3],
        [0.5, 0.5],
      ],
      [],
      [],
    ),
    null,
  );

  const valid = finalizeDraftPolygon(
    [
      [0.1, 0.1],
      [0.6, 0.1],
      [0.35, 0.7],
    ],
    [{ n: 2, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
    [],
  );
  assert.ok(valid !== null);
  assert.equal(valid.n, 3);
  assert.equal(valid.points.length, 3);
});
