import { test } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveItemRetention,
  effectiveReadingAFactor,
  interpolatePriorityEndpoint,
} from "../src/ir/priority-scheduling";

test("priority interpolation is monotonic and clamps priority", () => {
  assert.equal(interpolatePriorityEndpoint(-1, 0.95, 0.8), 0.95);
  assert.equal(interpolatePriorityEndpoint(50, 0.95, 0.8), 0.875);
  assert.equal(interpolatePriorityEndpoint(101, 0.95, 0.8), 0.8);
});

test("priority scheduling remains disabled until explicitly enabled", () => {
  assert.equal(effectiveItemRetention(0, false, 0.9, 0.99, 0.7), 0.9);
  assert.equal(effectiveReadingAFactor(0, false, 2.2, 1.2, 3), 2.2);
});

test("high priority maps to higher retention and lower A-Factor", () => {
  assert.ok(effectiveItemRetention(0, true, 0.9, 0.97, 0.8) >
    effectiveItemRetention(100, true, 0.9, 0.97, 0.8));
  assert.ok(effectiveReadingAFactor(0, true, 2, 1.3, 3) <
    effectiveReadingAFactor(100, true, 2, 1.3, 3));
});
