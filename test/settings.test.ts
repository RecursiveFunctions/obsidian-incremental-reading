import { test } from "node:test";
import assert from "node:assert/strict";
import { cloneDefaultSettings, DEFAULT_SETTINGS } from "../src/ir/settings-data";

test("cloneDefaultSettings matches DEFAULT_SETTINGS without sharing the object", () => {
  const copy = cloneDefaultSettings();
  assert.deepEqual(copy, DEFAULT_SETTINGS);
  assert.notEqual(copy, DEFAULT_SETTINGS);
  copy.reviewsPerReading = 0;
  copy.extractFolder = "tweaked";
  copy.showDivergencePicker = true;
  assert.equal(DEFAULT_SETTINGS.reviewsPerReading, 3);
  assert.equal(DEFAULT_SETTINGS.extractFolder, "");
  assert.equal(DEFAULT_SETTINGS.showDivergencePicker, false);
});
