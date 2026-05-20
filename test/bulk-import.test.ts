/**
 * Golden contract for src/ir/bulk-import.ts (v0.2 roadmap: bulk import).
 *
 * Pure paste-to-topic-plan transform. NO URL fetching; the caller hands
 * text already in hand. Deterministic: identical input yields a
 * byte-identical plan. Claude-authored, fenced out of the delegated
 * scope. Skips until the module exists; computed specifier keeps tsc
 * from failing on the missing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const SPEC = ["..", "src", "ir", "bulk-import.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const NOW = 1_700_000_000_000;
const DEFAULT_PRI = 50;

test("title falls back to a slug of the first non-empty line", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const plan = m.planBulkImport({
    text: "How browsers parse CSS\n\nThe parser consumes a token stream.",
    defaultPriority: DEFAULT_PRI,
    now: NOW,
  });
  assert.equal(plan.title, "How browsers parse CSS");
});

test("title respects an explicit titleHint", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const plan = m.planBulkImport({
    text: "Some body that should not be the title",
    defaultPriority: DEFAULT_PRI,
    now: NOW,
    titleHint: "My Chosen Title",
  });
  assert.equal(plan.title, "My Chosen Title");
});

test("title is trimmed and capped at 80 chars", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const long = "x".repeat(200);
  const plan = m.planBulkImport({
    text: long,
    defaultPriority: DEFAULT_PRI,
    now: NOW,
  });
  assert.equal(plan.title.length, 80);
  assert.ok(plan.title.startsWith("xxxx"));
});

test("title strips reserved/path-unsafe chars", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  // Obsidian/Windows reserved set: \ / : * ? " < > |
  const plan = m.planBulkImport({
    text: 'Why "C++" is/isn\\t < a > simple: language?|stuff*',
    defaultPriority: DEFAULT_PRI,
    now: NOW,
  });
  for (const ch of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    assert.ok(
      !plan.title.includes(ch),
      `title must not contain reserved char ${JSON.stringify(ch)}; got ${JSON.stringify(plan.title)}`,
    );
  }
  // The descriptive content should still survive in some form.
  assert.ok(plan.title.length > 0);
});

test("when title was synthesized from the first line, body drops that line", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const plan = m.planBulkImport({
    text: "How browsers parse CSS\n\nThe parser consumes a token stream.",
    defaultPriority: DEFAULT_PRI,
    now: NOW,
  });
  assert.ok(
    !plan.body.startsWith("How browsers parse CSS"),
    "body should not start with the line used as the title",
  );
  assert.ok(plan.body.includes("The parser consumes a token stream."));
});

test("when titleHint was used, body keeps the full input verbatim", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const text = "First line of pasted content.\n\nSecond paragraph here.";
  const plan = m.planBulkImport({
    text,
    defaultPriority: DEFAULT_PRI,
    now: NOW,
    titleHint: "Explicit Hint",
  });
  assert.equal(plan.body, text);
});

test("frontmatter seeds ir-type=topic, ir-priority, ir-due=now", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const plan = m.planBulkImport({
    text: "Some Article\n\nBody.",
    defaultPriority: 30,
    now: NOW,
  });
  assert.equal(plan.frontmatter["ir-type"], "topic");
  assert.equal(plan.frontmatter["ir-priority"], 30);
  assert.equal(plan.frontmatter["ir-due"], NOW);
});

test("identical input yields a byte-identical plan (determinism)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const input = {
    text: "Title Line\n\nBody paragraph one.\n\nBody paragraph two.",
    defaultPriority: 42,
    now: NOW,
  };
  const a = m.planBulkImport(input);
  const b = m.planBulkImport(input);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("empty input is rejected by returning a clearly-empty plan, not by throwing", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const plan = m.planBulkImport({
    text: "",
    defaultPriority: DEFAULT_PRI,
    now: NOW,
  });
  // Title must be a non-throwing fallback string; body may be empty.
  assert.equal(typeof plan.title, "string");
  assert.equal(typeof plan.body, "string");
  assert.equal(plan.frontmatter["ir-type"], "topic");
});

test("leading blank lines are skipped when synthesizing the title", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/bulk-import.ts not implemented yet");
  const plan = m.planBulkImport({
    text: "\n\n   \n\nReal Title Line\n\nThe body.",
    defaultPriority: DEFAULT_PRI,
    now: NOW,
  });
  assert.equal(plan.title, "Real Title Line");
  assert.ok(plan.body.includes("The body."));
});
