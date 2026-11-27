import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyConceptTemplate,
  formatSuperMemoReferenceFooter,
  parseSuperMemoReferenceFooter,
  readConceptFromFrontmatter,
  readReferenceFromFrontmatter,
  reconcileNoteFrontmatterWithLedger,
  resolveInheritedConceptAndReference,
  stripSuperMemoReferenceFooter,
  upsertConceptGroup,
  writeConceptToFrontmatter,
  writeReferenceToFrontmatter,
  type ConceptGroup,
  type ConceptRegistryState,
  type ReferenceMetadata,
} from "../src/ir/concepts-references";
import { fold } from "../src/ir/log";
import { IrLedger, type VaultFs } from "../src/ir/ledger";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import { newElement, validateIrEvent, type IrElement, type IrEvent } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DEV = newDeviceId();

function memFs(): VaultFs {
  const files = new Map<string, string>();
  return {
    async exists(p) {
      return files.has(p);
    },
    async read(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async write(p, data) {
      files.set(p, data);
    },
    async append(p, data) {
      files.set(p, (files.get(p) ?? "") + data);
    },
    async list(dir) {
      const pre = dir.endsWith("/") ? dir : dir + "/";
      const out: string[] = [];
      for (const k of files.keys()) {
        if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(k);
      }
      return out;
    },
  };
}

test("SuperMemo #SuperMemo Reference footer parses, strips, and formats round-trip", () => {
  const raw = [
    "Synaptic plasticity underlies long-term potentiation.",
    "",
    "#SuperMemo Reference:",
    "#Title: Principles of Neural Science",
    "#Author: Eric Kandel",
    "#Date: 2021",
    "#Source: McGraw-Hill",
    "#Link: https://example.org/kandel",
    "#Comment: Ch. 67",
  ].join("\n");

  const ref = parseSuperMemoReferenceFooter(raw);
  assert.deepEqual(ref, {
    title: "Principles of Neural Science",
    author: "Eric Kandel",
    date: "2021",
    source: "McGraw-Hill",
    link: "https://example.org/kandel",
    comment: "Ch. 67",
  });

  const bodyOnly = stripSuperMemoReferenceFooter(raw);
  assert.equal(bodyOnly, "Synaptic plasticity underlies long-term potentiation.");

  const formatted = formatSuperMemoReferenceFooter(ref!);
  assert.deepEqual(parseSuperMemoReferenceFooter(formatted), ref);
});

test("YAML frontmatter <-> Concept & Reference round-trips and harvests standard author/url keys", () => {
  const fm: Record<string, unknown> = {};
  const ref: ReferenceMetadata = {
    title: "Memory & Sleep",
    author: "Piotr Wozniak",
    date: "2024-05-01",
    link: "https://supermemo.guru",
  };
  writeConceptToFrontmatter(fm, "Neurobiology");
  writeReferenceToFrontmatter(fm, ref);

  assert.equal(readConceptFromFrontmatter(fm), "Neurobiology");
  assert.deepEqual(readReferenceFromFrontmatter(fm), ref);

  // Fallback harvest when ir_ref is absent but standard Obsidian keys exist
  const standardFm = { author: "Hermann Ebbinghaus", url: "https://ebbinghaus.de", date: "1885" };
  assert.deepEqual(readReferenceFromFrontmatter(standardFm), {
    author: "Hermann Ebbinghaus",
    link: "https://ebbinghaus.de",
    date: "1885",
  });
});

test("metadata-set event validates, folds onto IrElement, and propagates Concept + Reference down parent chain", async () => {
  const rootId = newElementId();
  const extractId = newElementId();
  const itemId = newElementId();

  const concept: ConceptGroup = {
    id: "concept_neuro",
    name: "Neurobiology",
    rootElementId: rootId,
    targetFolder: "IR/Neurobiology",
    defaultPriority: 18,
    itemTemplate: "## Recall\n{{content}}",
    updatedAt: NOW,
  };
  let reg: ConceptRegistryState = { version: 1, concepts: [] };
  reg = upsertConceptGroup(reg, concept);

  const ref: ReferenceMetadata = {
    title: "Hippocampal Replay",
    author: "Buzsaki",
    date: "2015",
  };

  const evRoot: IrEvent = {
    id: newEventId(),
    ts: NOW,
    lamport: 1,
    device: DEV,
    kind: "element-created",
    target: rootId,
    payload: {
      element: {
        ...newElement({ id: rootId, type: "topic", priority: 18, now: NOW }),
        conceptId: concept.id,
        reference: ref,
      },
    },
  };
  const evExtract: IrEvent = {
    id: newEventId(),
    ts: NOW + 100,
    lamport: 2,
    device: DEV,
    kind: "element-created",
    target: extractId,
    payload: {
      element: newElement({ id: extractId, type: "extract", priority: 22, parentId: rootId, now: NOW }),
    },
  };
  const evItem: IrEvent = {
    id: newEventId(),
    ts: NOW + 200,
    lamport: 3,
    device: DEV,
    kind: "element-created",
    target: itemId,
    payload: {
      element: newElement({ id: itemId, type: "item", priority: 25, parentId: extractId, now: NOW }),
    },
  };

  assert.equal(validateIrEvent(evRoot), null);
  const folded = fold([evRoot, evExtract, evItem], { conflict: "clock-order" });

  // Propagate from ancestor root -> extract -> item
  const inherited = resolveInheritedConceptAndReference(
    folded.elements.get(itemId)!,
    folded.elements,
    reg,
  );
  assert.equal(inherited.concept?.id, "concept_neuro");
  assert.equal(inherited.concept?.targetFolder, "IR/Neurobiology");
  assert.equal(inherited.concept?.defaultPriority, 18);
  assert.deepEqual(inherited.reference, ref);
  assert.equal(applyConceptTemplate(concept.itemTemplate, "Sharp-wave {{c1::ripples}}"), "## Recall\nSharp-wave {{c1::ripples}}");

  // Mutate via metadata-set event and verify idempotent frontmatter reconciliation
  const updatedRef: ReferenceMetadata = { ...ref, comment: "Key paper" };
  const evMeta: IrEvent = {
    id: newEventId(),
    ts: NOW + 300,
    lamport: 4,
    device: DEV,
    kind: "metadata-set",
    target: extractId,
    payload: { conceptId: concept.id, reference: updatedRef },
  };
  assert.equal(validateIrEvent(evMeta), null);
  const folded2 = fold([evRoot, evExtract, evItem, evMeta], { conflict: "clock-order" });
  assert.deepEqual(folded2.elements.get(extractId)?.reference, updatedRef);

  // Reconcile manual YAML edit -> creates new concept & emits metadata-set once, then no-ops when synced
  const manualFm: Record<string, unknown> = {
    ir_concept: " Immunology ",
    ir_ref: { author: "Janeway", title: "Immunobiology" },
  };
  const rec1 = reconcileNoteFrontmatterWithLedger(
    folded2.elements.get(extractId)!,
    manualFm,
    reg,
    NOW + 400,
  );
  assert.equal(rec1.changed, true);
  assert.equal(rec1.nextRegistry.concepts.length, 2);
  assert.equal(rec1.conceptId, "concept_immunology");
  assert.deepEqual(rec1.reference, { author: "Janeway", title: "Immunobiology" });

  const syncedEl: IrElement = {
    ...folded2.elements.get(extractId)!,
    conceptId: rec1.conceptId ?? undefined,
    reference: rec1.reference ?? undefined,
  };
  const rec2 = reconcileNoteFrontmatterWithLedger(syncedEl, manualFm, rec1.nextRegistry, NOW + 500);
  assert.equal(rec2.changed, false);

  // Persist ConceptRegistryState via IrLedger
  const ledger = new IrLedger(memFs(), { conflict: "clock-order" });
  await ledger.init({ hostname: "test-host" });
  await ledger.writeConcepts(rec1.nextRegistry);
  const loadedReg = await ledger.readConcepts();
  assert.equal(loadedReg.concepts.length, 2);
  assert.equal(loadedReg.concepts[1]!.name, "Immunology");
});
