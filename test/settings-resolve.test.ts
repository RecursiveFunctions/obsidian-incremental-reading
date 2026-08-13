import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveShowDivergencePicker } from "../src/ir/settings-resolve";

test("resolveShowDivergencePicker: new install (no data.json) is off", () => {
  assert.equal(resolveShowDivergencePicker(null), false);
  assert.equal(resolveShowDivergencePicker(undefined), false);
});

test("resolveShowDivergencePicker: existing install without the key stays on", () => {
  assert.equal(
    resolveShowDivergencePicker({} as { showDivergencePicker?: boolean }),
    true,
  );
  assert.equal(
    resolveShowDivergencePicker({ autoMarkSourceAsTopic: true } as {
      showDivergencePicker?: boolean;
    }),
    true,
  );
});

test("resolveShowDivergencePicker: explicit false stays off", () => {
  assert.equal(resolveShowDivergencePicker({ showDivergencePicker: false }), false);
});

test("resolveShowDivergencePicker: explicit true stays on", () => {
  assert.equal(resolveShowDivergencePicker({ showDivergencePicker: true }), true);
});
