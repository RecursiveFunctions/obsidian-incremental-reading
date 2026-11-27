import assert from "node:assert/strict";
import { test } from "node:test";
import {
  exportSm20BinaryPackage,
  exportSuperMemoQaText,
  exportSuperMemoXmlCollection,
  parseSuperMemoQaText,
  parseSuperMemoXmlCollection,
} from "../src/ir/sm20-exchange";
import { planSmCollectionImport, type SmSourceFs } from "../src/ir/sm-collection-import";
import { createEmptySm20Matrix, recordSm20Outcome } from "../src/ir/sm20-matrix";
import { newDeviceId, newElementId } from "../src/ir/ids";
import { newElement, validateIrEvent, type IrElement } from "../src/ir/model";
import type { ConceptGroup } from "../src/ir/concepts-references";

const NOW = 1_760_000_000_000;
const DAY_MS = 86_400_000;
const DEV = newDeviceId();

test("SuperMemo Q&A text (0x00c435f0) parses Q:/A: blocks + inline clozes and exports round-trip", () => {
  const txt = [
    "Q: What enzyme synthesizes cAMP from ATP?",
    "A: Adenylyl cyclase",
    "",
    "Q: Resting membrane potential of a typical neuron is [-70 mV].",
    "A: -70 mV",
  ].join("\n");

  const parsed = parseSuperMemoQaText(txt, NOW, DEV);
  assert.equal(parsed.elements.length, 2);
  assert.match(parsed.elements[0]!.text, /\{\{c1::Adenylyl cyclase\}\}/);
  assert.match(parsed.elements[1]!.text, /\{\{c1::-70 mV\}\}/);
  for (const ev of parsed.events) {
    assert.equal(validateIrEvent(ev), null);
  }

  const exported = exportSuperMemoQaText(parsed.elements);
  assert.match(exported, /^Q: /m);
  assert.match(exported, /^A: Adenylyl cyclase/m);
  const reparsed = parseSuperMemoQaText(exported, NOW, DEV);
  assert.equal(reparsed.elements.length, 2);
});

test("SuperMemo XML collection (0x00c3bf30) exports and re-imports nested hierarchy, LearningData, ConceptGroup & References", () => {
  const rootId = newElementId();
  const childItemId = newElementId();
  const concept: ConceptGroup = {
    id: "concept_cardio",
    name: "Cardiology",
    rootElementId: rootId,
    defaultPriority: 12,
    updatedAt: NOW,
  };

  const rootTopic: IrElement = {
    ...newElement({ id: rootId, type: "topic", priority: 12, now: NOW - 5 * DAY_MS }),
    text: "Cardiac cycle overview and ventricular filling.",
    conceptId: concept.id,
    reference: {
      title: "Guyton Physiology",
      author: "John Hall",
      date: "2021",
    },
    schedule: {
      due: NOW + 4 * DAY_MS,
      interval: 6,
      aFactor: 1.75,
    },
  };
  const childItem: IrElement = {
    ...newElement({ id: childItemId, type: "item", priority: 15, parentId: rootId, now: NOW - 3 * DAY_MS }),
    text: "What closes at the start of systole?\n\n{{c1::Mitral and tricuspid valves}}",
    conceptId: concept.id,
    card: {
      due: NOW + 10 * DAY_MS,
      stability: 10,
      difficulty: 4.5,
      elapsedDays: 4,
      scheduledDays: 10,
      reps: 3,
      lapses: 1,
      state: 2,
      lastReview: NOW - 4 * DAY_MS,
    },
  };

  const xml = exportSuperMemoXmlCollection([rootTopic, childItem], [concept], NOW);
  assert.match(xml, /<SuperMemoCollection>/);
  assert.match(xml, /<ConceptGroup>Cardiology<\/ConceptGroup>/);
  assert.match(xml, /#Author: John Hall/);

  const imported = parseSuperMemoXmlCollection(xml, NOW, DEV);
  assert.equal(imported.elements.length, 2);
  const impRoot = imported.elements.find((e) => e.type === "topic")!;
  const impItem = imported.elements.find((e) => e.type === "item")!;
  assert.ok(impRoot && impItem);
  assert.equal(impItem.parentId, impRoot.id);
  assert.equal(impItem.card?.reps, 3);
  assert.equal(impItem.card?.lapses, 1);
  assert.equal(impItem.card?.scheduledDays, 10);
  assert.equal(impRoot.reference?.author, "John Hall");
  assert.equal(imported.concepts.length, 1);
  assert.equal(imported.concepts[0]!.name, "Cardiology");
});

test("exportSm20BinaryPackage writes ElementInfo.dat, contents.dat, priority.sub, concept.dat & all 8 alg17 .dat files and round-trips through planSmCollectionImport", async () => {
  const topicId = newElementId();
  const itemId = newElementId();
  const topic: IrElement = {
    ...newElement({ id: topicId, type: "topic", priority: 10, now: NOW }),
    text: " Renal physiology filtration fraction ",
    reference: { title: "Brenner & Rector", author: "Taal" },
    schedule: { due: NOW + 3 * DAY_MS, interval: 3, aFactor: 1.8 },
  };
  const item: IrElement = {
    ...newElement({ id: itemId, type: "item", priority: 25, parentId: topicId, now: NOW }),
    text: "Normal GFR is approximately {{c1::125 mL/min}}.",
    card: {
      due: NOW + 8 * DAY_MS,
      stability: 8,
      difficulty: 4,
      elapsedDays: 3,
      scheduledDays: 8,
      reps: 2,
      lapses: 0,
      state: 2,
      lastReview: NOW - DAY_MS,
    },
  };

  const matrix = createEmptySm20Matrix();
  recordSm20Outcome(matrix, {
    prevDifficulty01: 0.3,
    prevStability: 4,
    retrievability: 0.9,
    nextStability: 12,
    smGrade: 4,
    prevReps: 1,
    prevLapses: 0,
    elapsedDays: 4,
  });

  const pkg = exportSm20BinaryPackage({
    elements: [topic, item],
    concepts: [{ id: "concept_renal", name: "Renal", rootElementId: topicId, defaultPriority: 10, updatedAt: NOW }],
    matrix,
    nowMs: NOW,
  });

  assert.ok(pkg.has("info/ElementInfo.dat"));
  assert.ok(pkg.has("info/contents.dat"));
  assert.ok(pkg.has("info/priority.sub"));
  assert.ok(pkg.has("registry/concept.dat"));
  assert.equal(pkg.get("registry/concept.dat")!.byteLength, 65);
  assert.ok(pkg.has("alg17/FirstInterval.dat"));
  assert.ok(pkg.has("alg17/ForgettingCurve.dat"));
  assert.ok(pkg.has("alg17/Retrievability.dat"));
  assert.ok(pkg.has("alg17/DifficultyDistribution.dat"));

  // Add a synthetic sound/media registry attachment to verify media import too!
  const fakeFs: SmSourceFs = {
    async listDir(relDir: string) {
      const clean = relDir.replace(/^\/+|\/+$/g, "").toLowerCase();
      const children = new Set<string>();
      for (const k of pkg.keys()) {
        const kl = k.toLowerCase();
        const prefix = clean ? `${clean}/` : "";
        if (kl.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          const first = rest.split("/")[0]!;
          if (first) children.add(first);
        }
      }
      return [...children];
    },
    async readBinary(relPath: string) {
      const target = relPath.replace(/^\/+/, "").toLowerCase();
      for (const [k, v] of pkg.entries()) {
        if (k.toLowerCase() === target) return v;
      }
      return null;
    },
  };

  const plan = await planSmCollectionImport({
    fs: fakeFs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SMImport",
  });

  assert.equal(plan.elements.length, 2);
  assert.ok(plan.sm20Baseline !== undefined);
  assert.equal(plan.sm20Baseline.version, 4);
  assert.equal(plan.sm20Baseline.forgettingCurveCases?.reduce((a, b) => a + b, 0), 1);
  assert.equal(plan.concepts?.length, 1);
});
