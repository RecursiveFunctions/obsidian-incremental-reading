import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeConceptRegistry,
  normalizeReference,
  parseSuperMemoReferenceFooter,
} from "../src/ir/concepts-references";
import { htmlToMarkdown } from "../src/ir/html-to-markdown";
import { newDeviceId } from "../src/ir/ids";
import { parseOcclusionJson } from "../src/ir/occlusion";
import {
  parseSuperMemoQaText,
  parseSuperMemoXmlCollection,
} from "../src/ir/sm20-exchange";
import {
  createEmptySm20Matrix,
  lookupBlendedSinc,
  restoreSm20Matrix,
  snapshotSm20Matrix,
} from "../src/ir/sm20-matrix";

const NOW = 1_760_000_000_000;
const DEV = newDeviceId();
const HTTPS = "ht" + "tps://";

test("STRIDE Tampering/Info-Disclosure: SuperMemo XML & Q&A imports strip <script>, <iframe>, event handlers, and remote image beacons", () => {
  const maliciousXml = [
    "<SuperMemoCollection>",
    "  <SuperMemoElement>",
    "    <ID>1</ID>",
    "    <Type>Item</Type>",
    `    <Content>`,
    `      <Question>What is ATP? &lt;script&gt;require('child_process').exec('id')&lt;/script&gt;&lt;iframe src="${HTTPS}evil.example/frame"&gt;bad&lt;/iframe&gt;&lt;img src="${HTTPS}evil.example/beacon.png" alt="diagram" onerror="alert(1)"&gt;</Question>`,
    `      <Answer>&lt;b onclick="evil()"&gt;Adenosine triphosphate&lt;/b&gt;</Answer>`,
    `    </Content>`,
    "  </SuperMemoElement>",
    "</SuperMemoCollection>",
  ].join("\n");

  const res = parseSuperMemoXmlCollection(maliciousXml, NOW, DEV);
  assert.equal(res.elements.length, 1);
  const text = res.elements[0]!.text;
  assert.doesNotMatch(text, /<script/i);
  assert.doesNotMatch(text, /child_process/i);
  assert.doesNotMatch(text, /<iframe/i);
  assert.doesNotMatch(text, /onerror/i);
  assert.doesNotMatch(text, /onclick/i);
  assert.doesNotMatch(text, /evil\.example\/beacon\.png/i);
  assert.match(text, /What is ATP\?/);
  assert.match(text, /\*\*Adenosine triphosphate\*\*/);

  const maliciousQa = [
    `Q: Cell membrane <script>evil()</script><img src="${HTTPS}evil.example/p.gif"> bilayer?`,
    "A: <object data='bad.swf'>Phospholipid</object>Phospholipid",
  ].join("\n");
  const qaRes = parseSuperMemoQaText(maliciousQa, NOW, DEV);
  assert.equal(qaRes.elements.length, 1);
  assert.doesNotMatch(qaRes.elements[0]!.text, /<script|<img|<object|evil\.example/i);
});

test("STRIDE DoS: deeply nested <SuperMemoElement> XML is capped iteratively without stack overflow", () => {
  const depth = 250;
  const opens = "<SuperMemoElement><Type>Topic</Type><Title>Node</Title>".repeat(depth);
  const closes = "</SuperMemoElement>".repeat(depth);
  const deepXml = `<SuperMemoCollection>${opens}${closes}</SuperMemoCollection>`;

  const res = parseSuperMemoXmlCollection(deepXml, NOW, DEV);
  // Bounded at MAX_XML_NESTING_DEPTH (64) without throwing RangeError
  assert.ok(res.elements.length > 0 && res.elements.length <= 64);
});

test("STRIDE Tampering/DoS: restoreSm20Matrix sanitizes NaN, Infinity, and negative SInc poison values", () => {
  const clean = snapshotSm20Matrix(createEmptySm20Matrix());
  const sincArr = [...(clean.sinc as number[])];
  sincArr[0] = Number.NaN;
  sincArr[1] = Number.POSITIVE_INFINITY;
  sincArr[2] = -999;
  const predArr = new Array<number>(38 * 30).fill(Number.NaN);

  const restored = restoreSm20Matrix({
    ...clean,
    sinc: sincArr,
    retrievabilityPredSum: predArr,
  });

  assert.ok(Number.isFinite(restored.sinc[0]!) && restored.sinc[0]! >= 0.5);
  assert.ok(Number.isFinite(restored.sinc[1]!) && restored.sinc[1]! <= 20);
  assert.ok(Number.isFinite(restored.sinc[2]!) && restored.sinc[2]! >= 0.5);
  assert.ok(restored.retrievabilityPredSum.every((v) => Number.isFinite(v) && v >= 0));
  assert.ok(Number.isFinite(lookupBlendedSinc(restored, 0.2, 5, 0.9)));
});

test("STRIDE Tampering/Amplification: ConceptGroup rejects __proto__/unsafe IDs and ReferenceMetadata caps field sizes", () => {
  const reg = normalizeConceptRegistry({
    version: 1,
    concepts: [
      { id: "__proto__", name: "ProtoTest", updatedAt: 1 },
      { id: "../bad/id", name: "SlashId", updatedAt: 2 },
    ],
  });
  assert.equal(reg.concepts.length, 2);
  assert.notEqual(reg.concepts[0]!.id, "__proto__");
  assert.match(reg.concepts[0]!.id, /^concept_/);
  assert.match(reg.concepts[1]!.id, /^concept_/);

  const huge = "A".repeat(10_000);
  const ref = normalizeReference({
    title: `${huge}\0bad`,
    author: " Normal Author ",
  });
  assert.ok(ref !== null);
  assert.ok(ref.title!.length <= 2048);
  assert.equal(ref.title!.includes("\0"), false);

  const footerRef = parseSuperMemoReferenceFooter(`#SuperMemo Reference:\n#Comment: ${huge}`);
  assert.ok(footerRef !== null && footerRef.comment!.length <= 2048);
});

test("STRIDE Tampering/DoS: parseOcclusionJson rejects path-traversal image refs and excessive polygon vertices, and htmlToMarkdown blocks ../ image embeds", () => {
  assert.equal(
    parseOcclusionJson(
      JSON.stringify({
        image: "../../etc/passwd",
        mode: "hide-all",
        active: 1,
        rects: [{ n: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      }),
    ),
    null,
  );

  const mdTraversal = htmlToMarkdown('<img src="../../secret.png" alt="pic">');
  assert.doesNotMatch(mdTraversal, /\.\.\//);

  const hugeVertices = Array.from({ length: 2000 }, (_, i) => [
    (i % 100) / 100,
    Math.floor(i / 100) / 20,
  ]);
  const polySpec = parseOcclusionJson(
    JSON.stringify({
      image: "Safe/anatomy.png",
      mode: "hide-all",
      active: 1,
      rects: [],
      polygons: [{ n: 1, points: hugeVertices }],
    }),
  );
  // Either rejected or capped at <= 500 vertices
  assert.ok(polySpec === null || (polySpec.polygons?.[0]?.points.length ?? 0) <= 500);
});
