import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  QuizSessionStore,
  buildMcqAuthoringBlock,
  buildOrderAuthoringBlock,
  computeCardQuizSuggestedSmGrade,
  parseMcqPayload,
  parseOrderPayload,
  shuffleMcqOptions,
} from "../src/ir/interactive-items";
import { resolveSpaceConfirmGrade } from "../src/ir/review-keys";
import { previewSuperMemoExchangeInput } from "../src/ir/sm20-exchange";

describe("SM-20 Usability Polish — Quiz Grade Suggestion & Confirm Flow", () => {
  it("computes conservative suggested SmGrade across Spell-Pad, MCQ, and Ordering blocks", () => {
    const store = new QuizSessionStore();
    const typed = new Map<string, string>();

    // 1. Spell-Pad exact match -> 5; blank -> <= 1
    const spellBody = "Powerhouse of the cell: {{c1:=mitochondria::organelle}}";
    assert.equal(
      computeCardQuizSuggestedSmGrade(spellBody, {
        slotId: "el1",
        sourcePath: "bio.md",
        daySeed: 42,
        typedAnswers: typed,
        quizStore: store,
      }),
      0,
    );

    typed.set("el1:0", "mitochondria");
    assert.equal(
      computeCardQuizSuggestedSmGrade(spellBody, {
        slotId: "el1",
        sourcePath: "bio.md",
        daySeed: 42,
        typedAnswers: typed,
        quizStore: store,
      }),
      5,
    );

    // 2. MCQ block: unselected -> 1; selecting correct shuffled option -> 5
    const mcqSrc = "Which neurotransmitter is excitatory?\n- [x] Glutamate\n- [ ] GABA\n- [ ] Glycine";
    const mcqBody = "```ir-mcq\n" + mcqSrc + "\n```";
    assert.equal(
      computeCardQuizSuggestedSmGrade(mcqBody, {
        slotId: "el2",
        sourcePath: "neuro.md",
        daySeed: 7,
        typedAnswers: new Map(),
        quizStore: store,
      }),
      1,
    );

    const spec = parseMcqPayload(mcqSrc)!;
    const shuffled = shuffleMcqOptions(spec.options, 7);
    const correctIdx = shuffled.findIndex((o) => o.correct);
    store.toggleMcqOption(`el2::mcq::${mcqSrc}`, correctIdx);
    assert.equal(
      computeCardQuizSuggestedSmGrade(mcqBody, {
        slotId: "el2",
        sourcePath: "neuro.md",
        daySeed: 7,
        typedAnswers: new Map(),
        quizStore: store,
      }),
      4,
    );

    // 3. Multi-quiz card takes minimum grade if second quiz is wrong
    const combined = `${spellBody}\n\n${mcqBody}`;
    const wrongTyped = new Map<string, string>([["el2:0", "ribosome"]]);
    const combinedGrade = computeCardQuizSuggestedSmGrade(combined, {
      slotId: "el2",
      sourcePath: "neuro.md",
      daySeed: 7,
      typedAnswers: wrongTyped,
      quizStore: store,
    });
    assert.ok(combinedGrade !== null && combinedGrade <= 2);
  });

  it("maps Space confirmation to suggested grade on both 4-point and 6-point docks", () => {
    // Standard 4-point without quiz -> configured spaceAfterReveal
    assert.equal(
      resolveSpaceConfirmGrade({
        gradingScale: "4-point",
        spaceAfterReveal: "good",
        suggestedSmGrade: null,
      }),
      "good",
    );
    assert.equal(
      resolveSpaceConfirmGrade({
        gradingScale: "4-point",
        spaceAfterReveal: "off",
        suggestedSmGrade: null,
      }),
      null,
    );

    // Standard 4-point WITH failed quiz (SmGrade 1) -> highlights & confirms "again", NEVER "good"!
    assert.equal(
      resolveSpaceConfirmGrade({
        gradingScale: "4-point",
        spaceAfterReveal: "good",
        suggestedSmGrade: 1,
      }),
      "again",
    );
    assert.equal(
      resolveSpaceConfirmGrade({
        gradingScale: "4-point",
        spaceAfterReveal: "good",
        suggestedSmGrade: 5,
      }),
      "easy",
    );

    // SM-20 6-point without quiz -> defaults to SmGrade 4 (Good)
    assert.equal(
      resolveSpaceConfirmGrade({
        gradingScale: "sm20-6-point",
        spaceAfterReveal: "good",
        suggestedSmGrade: null,
      }),
      4,
    );
    // SM-20 6-point WITH quiz -> confirms exact SmGrade 0..5
    assert.equal(
      resolveSpaceConfirmGrade({
        gradingScale: "sm20-6-point",
        spaceAfterReveal: "good",
        suggestedSmGrade: 2,
      }),
      2,
    );
  });

  it("builds valid authoring blocks for ir-mcq and ir-order from selection or empty cursor", () => {
    const mcqFromLines = buildMcqAuthoringBlock(
      "Which chamber pumps oxygenated blood to the aorta?\nLeft ventricle\nRight atrium\nLeft atrium",
    );
    const innerMcq = mcqFromLines.replace(/^```ir-mcq\n|\n```$/g, "");
    const parsedMcq = parseMcqPayload(innerMcq);
    assert.ok(parsedMcq);
    assert.equal(parsedMcq.prompt, "Which chamber pumps oxygenated blood to the aorta?");
    assert.equal(parsedMcq.options.length, 3);
    assert.equal(parsedMcq.options[0]?.correct, true);
    assert.equal(parsedMcq.options[1]?.correct, false);

    const mcqStarter = buildMcqAuthoringBlock("");
    assert.ok(parseMcqPayload(mcqStarter.replace(/^```ir-mcq\n|\n```$/g, "")));

    const orderFromLines = buildOrderAuthoringBlock(
      "1. Prophase\n2. Metaphase\n3. Anaphase\n4. Telophase",
    );
    const parsedOrder = parseOrderPayload(orderFromLines.replace(/^```ir-order\n|\n```$/g, ""));
    assert.ok(parsedOrder);
    assert.deepEqual(parsedOrder.items, ["Prophase", "Metaphase", "Anaphase", "Telophase"]);

    const orderStarter = buildOrderAuthoringBlock("");
    assert.ok(parseOrderPayload(orderStarter.replace(/^```ir-order\n|\n```$/g, "")));
  });

  it("previews SuperMemo XML and Q&A text imports non-destructively with counts and sample titles", () => {
    const emptyPreview = previewSuperMemoExchangeInput("   ", 33);
    assert.equal(emptyPreview.format, "empty");
    assert.equal(emptyPreview.totalCount, 0);

    const qaPreview = previewSuperMemoExchangeInput(
      "Q: What is LTP?\nA: Long-term potentiation\n\nQ: What receptor mediates NMDA Ca2+ influx?\nA: NMDA receptor",
      33,
    );
    assert.equal(qaPreview.format, "qa-txt");
    assert.equal(qaPreview.totalCount, 2);
    assert.equal(qaPreview.itemCount, 2);
    assert.equal(qaPreview.samples.length, 2);
    assert.match(qaPreview.samples[0]!, /What is LTP\?/);

    const xmlPreview = previewSuperMemoExchangeInput(
      `<?xml version="1.0"?>
<SuperMemoCollection>
  <SuperMemoElement>
    <Type>Topic</Type>
    <Title>Neurobiology Root</Title>
    <ConceptGroup>Neurobiology</ConceptGroup>
    <SuperMemoElement>
      <Type>Item</Type>
      <Question>Resting potential of neuron?</Question>
      <Answer>-70 mV</Answer>
    </SuperMemoElement>
  </SuperMemoElement>
</SuperMemoCollection>`,
      33,
    );
    assert.equal(xmlPreview.format, "sm-xml");
    assert.equal(xmlPreview.totalCount, 2);
    assert.equal(xmlPreview.topicCount, 1);
    assert.equal(xmlPreview.itemCount, 1);
    assert.deepEqual(xmlPreview.conceptNames, ["Neurobiology"]);
    assert.equal(xmlPreview.samples[0], "Neurobiology Root");
  });
});
