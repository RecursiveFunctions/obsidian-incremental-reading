import { test } from "node:test";
import assert from "node:assert/strict";
import { formatSmReadWarning, SmReadDiagnostics } from "../src/ir/sm-collection-import";

test("read diagnostics produce no warning when nothing failed", () => {
  const d = new SmReadDiagnostics();
  assert.equal(d.count, 0);
  assert.equal(formatSmReadWarning(d.count), "");
});

test("read diagnostics count each failure and format an observable warning", () => {
  const d = new SmReadDiagnostics();
  d.noteFailure();
  d.noteFailure();
  assert.equal(d.count, 2);
  assert.equal(
    formatSmReadWarning(d.count),
    " (2 collection files could not be read; results may be incomplete)",
  );
});

test("read warning uses singular wording for one failure", () => {
  assert.equal(
    formatSmReadWarning(1),
    " (1 collection file could not be read; results may be incomplete)",
  );
});
