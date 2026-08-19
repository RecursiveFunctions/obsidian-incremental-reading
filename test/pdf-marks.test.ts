import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfMarksBySourcePath } from "../src/ir/pdf-marks";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

function extract(p: Omit<Partial<IrElement>, "id"> & { id: string }): IrElement {
  return {
    type: "extract",
    priority: 50,
    parentId: "el_parent" as ElementId,
    dismissed: false,
    created: 0,
    text: "hello",
    anchorState: "ok",
    ...p,
    id: p.id as ElementId,
  };
}

test("pdfMarksBySourcePath groups unpromoted PDF extracts by sourcePath", () => {
  const a = extract({
    id: "el_a",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "hello", prefix: "", suffix: "" },
      pdf: { page: 2, selection: [1, 0, 1, 5] },
    },
  });
  const b = extract({
    id: "el_b",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "world", prefix: "", suffix: "" },
      pdf: { page: 3, selection: [4, 0, 4, 5] },
    },
  });
  const md = extract({
    id: "el_md",
    anchor: {
      sourcePath: "Notes/a.md",
      quote: { exact: "nope", prefix: "", suffix: "" },
      position: { start: 0, end: 4 },
    },
  });
  const promoted = extract({
    id: "el_p",
    notePath: "Extracts/hello.md",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "hello", prefix: "", suffix: "" },
      pdf: { page: 2, selection: [1, 0, 1, 5] },
    },
  });
  const pageOnly = extract({
    id: "el_page",
    anchor: {
      sourcePath: "Papers/x.pdf",
      quote: { exact: "", prefix: "", suffix: "" },
      pdf: { page: 9, selection: [0, 0, 0, 0] },
    },
  });

  const map = pdfMarksBySourcePath([a, b, md, promoted, pageOnly]);
  assert.equal(map.size, 1);
  const marks = map.get("Papers/x.pdf") ?? [];
  assert.equal(marks.length, 2);
  assert.deepEqual(
    marks.map((m) => m.elementId).sort(),
    ["el_a", "el_b"],
  );
});
