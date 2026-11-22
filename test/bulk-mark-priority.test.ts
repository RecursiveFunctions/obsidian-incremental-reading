import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleBulkMarkCandidates,
  classifyVaultEntry,
  evenSpacedPriorities,
  planBulkMarkPriorities,
} from "../src/ir/bulk-mark-priority";

test("evenSpacedPriorities: N=1 uses start", () => {
  assert.deepEqual(evenSpacedPriorities(1, 20, 80), [20]);
});

test("evenSpacedPriorities: evenly spaces inclusive endpoints", () => {
  assert.deepEqual(evenSpacedPriorities(3, 0, 100), [0, 50, 100]);
});

test("planBulkMarkPriorities: default fills every slot", () => {
  const plan = planBulkMarkPriorities(4, { kind: "default" }, 33);
  assert.equal(plan.ok, true);
  if (plan.ok) assert.deepEqual(plan.priorities, [33, 33, 33, 33]);
});

test("planBulkMarkPriorities: rejects inverted range", () => {
  const plan = planBulkMarkPriorities(2, { kind: "range", min: 80, max: 10 }, 50);
  assert.equal(plan.ok, false);
});

test("planBulkMarkPriorities: rejects band too narrow for N", () => {
  const plan = planBulkMarkPriorities(
    5,
    { kind: "range", min: 10, max: 10.0002 },
    50,
  );
  assert.equal(plan.ok, false);
});

test("assembleBulkMarkCandidates: expands folders, dedupes, sorts; preview=attempted", () => {
  const files = [
    { path: "B/z.md", extension: "md" },
    { path: "A/a.md", extension: "md" },
    { path: "A/b.pdf", extension: "pdf" },
    { path: "A/skip.md", extension: "md" },
    { path: "solo.md", extension: "md" },
  ];
  const skip = new Set(["A/skip.md"]);
  const attempted = assembleBulkMarkCandidates(
    files,
    [
      { path: "A", kind: "folder" },
      { path: "solo.md", kind: "file" },
      { path: "A/a.md", kind: "file" },
    ],
    skip,
  );
  assert.deepEqual(
    attempted.map((f) => f.path),
    ["A/a.md", "A/b.pdf", "solo.md"],
  );
});

test("classifyVaultEntry: structural folder vs file", () => {
  assert.deepEqual(classifyVaultEntry({ path: "Notes", children: [] }), {
    path: "Notes",
    kind: "folder",
  });
  assert.deepEqual(classifyVaultEntry({ path: "a.md", extension: "md" }), {
    path: "a.md",
    kind: "file",
  });
  assert.equal(classifyVaultEntry({ path: "x.png", extension: "png" }), null);
});
