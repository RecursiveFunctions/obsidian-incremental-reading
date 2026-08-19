import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPdfFragment,
  formatPdfLinktext,
  isPdfAnchor,
  isPdfPath,
  parsePdfFragment,
  pdfSelectionIsRange,
} from "../src/ir/pdf-fragment";

test("isPdfPath: extension only, case-insensitive", () => {
  assert.equal(isPdfPath("Papers/foo.pdf"), true);
  assert.equal(isPdfPath("Papers/foo.PDF"), true);
  assert.equal(isPdfPath("Papers/foo.md"), false);
  assert.equal(isPdfPath("pdf"), false);
});

test("isPdfAnchor: pdf selector or .pdf sourcePath", () => {
  assert.equal(
    isPdfAnchor({
      sourcePath: "a.pdf",
      pdf: { page: 1, selection: [0, 0, 1, 1] },
    }),
    true,
  );
  assert.equal(isPdfAnchor({ sourcePath: "a.pdf" }), true);
  assert.equal(isPdfAnchor({ sourcePath: "a.md" }), false);
});

test("formatPdfFragment: page-only and selection", () => {
  assert.equal(formatPdfFragment(10), "#page=10");
  assert.equal(formatPdfFragment(10, [16, 0, 16, 20]), "#page=10&selection=16,0,16,20");
  assert.equal(formatPdfFragment(0), "#page=1");
});

test("formatPdfLinktext prepends the vault path", () => {
  assert.equal(
    formatPdfLinktext("Papers/foo.pdf", 3, [1, 0, 2, 4]),
    "Papers/foo.pdf#page=3&selection=1,0,2,4",
  );
});

test("parsePdfFragment: page-only and selection round-trip", () => {
  assert.deepEqual(parsePdfFragment("#page=10"), {
    page: 10,
    selection: [0, 0, 0, 0],
  });
  assert.deepEqual(parsePdfFragment("page=10&selection=16,0,16,20"), {
    page: 10,
    selection: [16, 0, 16, 20],
  });
  const frag = formatPdfFragment(4, [1, 2, 3, 4]);
  assert.deepEqual(parsePdfFragment(frag), {
    page: 4,
    selection: [1, 2, 3, 4],
  });
});

test("parsePdfFragment: rejects bad page or selection", () => {
  assert.equal(parsePdfFragment(""), null);
  assert.equal(parsePdfFragment("#page=0"), null);
  assert.equal(parsePdfFragment("#page=1.5"), null);
  assert.equal(parsePdfFragment("#page=1&selection=1,2,3"), null);
  assert.equal(parsePdfFragment("#page=1&selection=a,b,c,d"), null);
});

test("pdfSelectionIsRange: page-only placeholder is not a range", () => {
  assert.equal(pdfSelectionIsRange([0, 0, 0, 0]), false);
  assert.equal(pdfSelectionIsRange([16, 0, 16, 20]), true);
});
