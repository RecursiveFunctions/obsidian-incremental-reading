/**
 * Golden contract for src/ir/extract.ts (DESIGN.md section 2:
 * block-anchored extracts + explicit promotion).
 *
 * Claude-authored, fenced OUT of the delegated scope. The executor
 * implements src/ir/extract.ts from TASK.md and is judged by this suite
 * plus tsc. Until the file exists every test skips, so `npm test` stays
 * green; once implemented the contract is enforced. The module specifier
 * is computed so tsc treats the dynamic import as `any` and does not
 * fail the build on the not-yet-existing module.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fold } from "../src/ir/log";
import { resolveAnchor } from "../src/ir/anchor";
import type { IrElement } from "../src/ir/model";
import type { ElementId, EventId, DeviceId } from "../src/ir/ids";

const SPEC = ["..", "src", "ir", "extract.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

const SOURCE = "The quick brown fox jumps over the lazy dog.";
const baseInput = () => ({
  sourcePath: "Notes/Animals.md",
  sourceText: SOURCE,
  selStart: 4,
  selEnd: 9, // "quick"
  parentId: "el_parent" as ElementId,
  priority: 150, // must clamp to 100
  elementId: "el_extract" as ElementId,
  eventId: "ev_extract" as EventId,
  device: "dev_test" as DeviceId,
  lamport: 7,
  now: 1_700_000_000_000,
});

test("buildExtractEvent: one element-created event with the right envelope", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const ev = m.buildExtractEvent(baseInput());
  assert.equal(ev.kind, "element-created");
  assert.equal(ev.id, "ev_extract");
  assert.equal(ev.target, "el_extract");
  assert.equal(ev.device, "dev_test");
  assert.equal(ev.lamport, 7);
  assert.equal(ev.ts, 1_700_000_000_000);
});

test("buildExtractEvent: element carries verbatim text, clamped priority, anchor", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const el = m.buildExtractEvent(baseInput()).payload.element as IrElement;
  assert.equal(el.type, "extract");
  assert.equal(el.parentId, "el_parent");
  assert.equal(el.priority, 100); // clamped from 150
  assert.equal(el.text, "quick"); // verbatim slice, Q1 principle 2
  assert.equal(el.anchorState, "ok");
  assert.equal(el.notePath, undefined); // anchored, not promoted
  assert.equal(el.card, undefined);
  assert.equal(el.schedule, undefined);
  assert.equal(el.created, 1_700_000_000_000);

  assert.ok(el.anchor);
  assert.equal(el.anchor.sourcePath, "Notes/Animals.md");
  assert.equal(el.anchor.quote.exact, "quick");
  assert.equal(el.anchor.quote.prefix, "The ");
  assert.equal(el.anchor.quote.suffix, " brown fox jumps over the lazy dog.");
  assert.deepEqual(el.anchor.position, { start: 4, end: 9 });
});

test("buildExtractEvent: anchor round-trips through the live anchor engine", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const el = m.buildExtractEvent(baseInput()).payload.element as IrElement;
  const r = resolveAnchor(el.anchor!, SOURCE);
  assert.deepEqual(r, { status: "ok", start: 4, end: 9, repaired: false });
});

test("buildExtractEvent: context window honours contextLen", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const el = m
    .buildExtractEvent({ ...baseInput(), contextLen: 3 })
    .payload.element as IrElement;
  assert.equal(el.anchor!.quote.prefix, "he ");
  assert.equal(el.anchor!.quote.suffix, " br");
});

test("buildExtractEvent: optional schedule is attached for the reading queue", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const sched = { due: 1_700_000_000_000, interval: 0, aFactor: 2 };
  const el = m
    .buildExtractEvent({ ...baseInput(), schedule: sched })
    .payload.element as IrElement;
  assert.deepEqual(el.schedule, sched);
});

test("buildExtractEvent: deterministic (byte-identical on re-run)", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const a = JSON.stringify(m.buildExtractEvent(baseInput()));
  const b = JSON.stringify(m.buildExtractEvent(baseInput()));
  assert.equal(a, b);
});

test("fold applies the extract; promotion sets notePath", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const create = m.buildExtractEvent(baseInput());
  const promote = m.buildPromoteEvent({
    elementId: "el_extract" as ElementId,
    notePath: "Promoted/Quick.md",
    eventId: "ev_promote" as EventId,
    device: "dev_test" as DeviceId,
    lamport: 8,
    now: 1_700_000_000_001,
  });
  assert.equal(promote.kind, "promoted");

  const before = fold([create]).elements.get("el_extract" as ElementId);
  assert.ok(before);
  assert.equal(before!.notePath, undefined);

  const after = fold([create, promote]).elements.get(
    "el_extract" as ElementId,
  );
  assert.ok(after);
  assert.equal(after!.notePath, "Promoted/Quick.md");
});

test("buildExtractEvent: strips extract-mark chrome from stored text but keeps it in the anchor", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  // Source body where an earlier sibling extract already wrapped "brown" in
  // <mark>; the user now extracts a span that includes that nested chrome.
  const sourceWithMark =
    'The quick <mark class="ir-extract-source">brown</mark> fox.';
  const ev = m.buildExtractEvent({
    ...baseInput(),
    sourceText: sourceWithMark,
    selStart: sourceWithMark.indexOf("quick"),
    selEnd: sourceWithMark.indexOf("fox") + "fox".length,
  });
  const el = ev.payload.element as IrElement;
  // Stored text is what the user sees: chrome stripped.
  assert.equal(el.text, "quick brown fox");
  // Anchor's verbatim slice keeps the chrome so re-locate-by-text still
  // matches the parent body as it actually exists on disk.
  assert.ok(el.anchor);
  assert.equal(
    el.anchor!.quote.exact,
    'quick <mark class="ir-extract-source">brown</mark> fox',
  );
});

test("buildTextEditedEvent + fold updates element.text without touching the anchor", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const create = m.buildExtractEvent(baseInput());
  const edit = m.buildTextEditedEvent({
    elementId: "el_extract" as ElementId,
    text: "quick (my notes on quickness)",
    eventId: "ev_edit" as EventId,
    device: "dev_test" as DeviceId,
    lamport: 9,
    now: 1_700_000_000_002,
  });
  assert.equal(edit.kind, "text-edited");

  const after = fold([create, edit]).elements.get("el_extract" as ElementId);
  assert.ok(after);
  assert.equal(after!.text, "quick (my notes on quickness)");
  // Anchor untouched: source span still points to "quick" in the parent.
  assert.equal(after!.anchor?.quote.exact, "quick");
  assert.deepEqual(after!.anchor?.position, { start: 4, end: 9 });
});

test("buildTextEditedEvent: deterministic", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/extract.ts not implemented yet");

  const args = {
    elementId: "el_extract" as ElementId,
    text: "edited",
    eventId: "ev_edit" as EventId,
    device: "dev_test" as DeviceId,
    lamport: 5,
    now: 1_700_000_000_000,
  };
  assert.equal(
    JSON.stringify(m.buildTextEditedEvent(args)),
    JSON.stringify(m.buildTextEditedEvent(args)),
  );
});
