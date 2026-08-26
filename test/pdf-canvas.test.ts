import { test } from "node:test";
import assert from "node:assert/strict";
import { joinSelectionTexts, pageLabel, pdfCropStem } from "../src/ir/pdf-canvas";
import { pdfMarksBySourcePath } from "../src/ir/pdf-marks";
import { buildPdfExtractEvent, buildExtractEvent } from "../src/ir/extract";
import { findExtractRange } from "../src/ir/extract-range";
import type { IrElement } from "../src/ir/model";
import type { ElementId, EventId, DeviceId } from "../src/ir/ids";

test("joinSelectionTexts / pageLabel / pdfCropStem", () => {
  assert.equal(joinSelectionTexts([" a ", "", "b"]), "a\n\nb");
  assert.equal(pageLabel([]), "");
  assert.equal(pageLabel([3]), "p. 3");
  assert.equal(pageLabel([5, 3, 5]), "pp. 3, 5");
  assert.equal(pdfCropStem("Papers/My: Paper.pdf", 4), "My Paper p4");
});

const ids = (n: string) => ({
  parentId: "el_p" as ElementId,
  priority: 50,
  elementId: `el_${n}` as ElementId,
  eventId: `ev_${n}` as EventId,
  device: "dev_t" as DeviceId,
  lamport: 1,
  now: 1,
});

test("multi-segment PDF extract paints one mark per segment; rect-only paints none", () => {
  const multi = buildPdfExtractEvent({
    ...ids("m"),
    sourcePath: "a.pdf",
    text: "one\n\ntwo",
    pdf: {
      page: 2,
      selection: [1, 0, 2, 3],
      segments: [
        { page: 2, selection: [1, 0, 2, 3] },
        { page: 4, selection: [7, 1, 7, 9] },
      ],
    },
  }).payload.element as IrElement;
  const crop = buildPdfExtractEvent({
    ...ids("c"),
    sourcePath: "a.pdf",
    text: "![[a p3.png]]",
    pdf: { page: 3, selection: [0, 0, 0, 0], rect: { x: 0.1, y: 0.1, w: 0.5, h: 0.2 } },
  }).payload.element as IrElement;
  assert.deepEqual(multi.anchor?.pdf?.segments?.length, 2);
  assert.deepEqual(crop.anchor?.pdf?.rect, { x: 0.1, y: 0.1, w: 0.5, h: 0.2 });
  const marks = pdfMarksBySourcePath([multi, crop]);
  const a = marks.get("a.pdf") ?? [];
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((m) => m.page), [2, 4]);
});

test("buildExtractEvent textOverride keeps the anchor on the first span", () => {
  const src = "alpha beta gamma delta";
  const el = buildExtractEvent({
    ...ids("t"),
    sourcePath: "n.md",
    sourceText: src,
    selStart: 0,
    selEnd: 5,
    textOverride: "alpha\n\ngamma",
  }).payload.element as IrElement;
  assert.equal(el.text, "alpha\n\ngamma");
  assert.equal(el.anchor?.quote.exact, "alpha");
  assert.deepEqual(findExtractRange(el, src), { start: 0, end: 5 });
});
