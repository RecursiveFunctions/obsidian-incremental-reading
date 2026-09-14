import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCLUSION_LABELS,
  extractRevlog,
  fitTier,
  formatDataReport,
  type ExclusionReason,
} from "../src/ir/optimizer/revlog";
import { fold } from "../src/ir/log";
import type { IrElement, IrEvent } from "../src/ir/model";
import type { ElementId, EventId } from "../src/ir/ids";

const NOW = new Date("2026-09-14T00:00:00.000Z").getTime();
const DAY = 86_400_000;

let autoLamport = 0;

function el(id: string): IrElement {
  return {
    id: id as ElementId,
    type: "item",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: NOW - 30 * DAY,
    text: `text of ${id}`,
    anchorState: "ok",
  };
}

function ev(partial: {
  id: string;
  kind: IrEvent["kind"];
  target: string;
  ts?: number;
  lamport?: number;
  payload?: Record<string, unknown>;
}): IrEvent {
  autoLamport += 1;
  return {
    id: partial.id as EventId,
    ts: partial.ts ?? NOW,
    lamport: partial.lamport ?? autoLamport,
    device: "test-device" as IrEvent["device"],
    kind: partial.kind,
    target: partial.target as ElementId,
    payload: partial.payload ?? {},
  };
}

function created(id: string): IrEvent {
  return ev({
    id: `create-${id}`,
    kind: "element-created",
    target: id,
    payload: { element: el(id) },
  });
}

function graded(
  id: string,
  target: string,
  opts: { grade?: unknown; ts?: number; lamport?: number; overridden?: boolean } = {},
): IrEvent {
  const payload: Record<string, unknown> = { card: {} };
  if ("grade" in opts) payload.grade = opts.grade;
  if (opts.overridden) payload.overridden = true;
  return ev({
    id,
    kind: "graded",
    target,
    ts: opts.ts,
    lamport: opts.lamport,
    payload,
  });
}

function run(events: IrEvent[]) {
  return extractRevlog(events, fold(events, { conflict: "clock-order" }));
}

function count(rows: { reason: ExclusionReason; count: number }[], r: ExclusionReason) {
  return rows.find((row) => row.reason === r)?.count ?? -1;
}

test("happy path: reviews group by card in lamport order", () => {
  const events = [
    created("a"),
    created("b"),
    graded("g1", "a", { grade: 3, ts: NOW - 10 * DAY, lamport: 100 }),
    graded("g3", "a", { grade: 4, ts: NOW - 1 * DAY, lamport: 300 }),
    graded("g2", "a", { grade: 1, ts: NOW - 5 * DAY, lamport: 200 }),
    graded("g4", "b", { grade: 3, ts: NOW - 8 * DAY, lamport: 150 }),
    graded("g5", "b", { grade: 3, ts: NOW - 2 * DAY, lamport: 250 }),
  ];
  const { cards, report } = run(events);
  assert.equal(cards.length, 2);
  const a = cards.find((c) => c.elementId === ("a" as ElementId))!;
  assert.deepEqual(
    a.reviews.map((r) => r.rating),
    [3, 1, 4],
  );
  assert.equal(report.includedReviews, 5);
  assert.equal(report.includedCards, 2);
  assert.equal(report.overriddenIncluded, 0);
  for (const row of report.rows) assert.equal(row.count, 0);
});

test("pre-0.7.15 events (no grade in payload) are excluded as noRating", () => {
  const events = [
    created("a"),
    graded("old1", "a", {}), // no grade key at all
    graded("old2", "a", { grade: "good" }), // wrong type
    graded("old3", "a", { grade: 7 }), // out of range
    graded("g1", "a", { grade: 3 }),
    graded("g2", "a", { grade: 3 }),
  ];
  const { report } = run(events);
  assert.equal(count(report.rows, "noRating"), 3);
  assert.equal(report.includedReviews, 2);
});

test("grade-undone voids exactly the targeted review", () => {
  const events = [
    created("a"),
    graded("g1", "a", { grade: 1 }),
    graded("g2", "a", { grade: 3 }),
    graded("g3", "a", { grade: 4 }),
    ev({
      id: "undo-1",
      kind: "grade-undone",
      target: "a",
      payload: { eventId: "g2" },
    }),
  ];
  const { cards, report } = run(events);
  assert.equal(count(report.rows, "undone"), 1);
  assert.deepEqual(
    cards[0]!.reviews.map((r) => r.rating),
    [1, 4],
  );
});

test("reviews of deleted elements are excluded as missingElement", () => {
  const events = [
    created("a"),
    created("gone"),
    graded("g1", "a", { grade: 3 }),
    graded("g2", "a", { grade: 3 }),
    graded("g3", "gone", { grade: 2 }),
    graded("g4", "gone", { grade: 3 }),
    ev({ id: "del-1", kind: "element-deleted", target: "gone" }),
  ];
  const state = fold(events, { conflict: "clock-order" });
  // Guard the premise: the fold really removed it.
  assert.equal(state.elements.has("gone" as ElementId), false);
  const { cards, report } = extractRevlog(events, state);
  assert.equal(count(report.rows, "missingElement"), 2);
  assert.equal(cards.length, 1);
});

test("a duplicated event (same id twice, sync artifact) counts once", () => {
  const g = graded("g1", "a", { grade: 3, lamport: 10 });
  const events = [
    created("a"),
    g,
    { ...g }, // shard duplication: identical event object appears twice
    graded("g2", "a", { grade: 3, lamport: 20 }),
  ];
  const { cards, report } = run(events);
  assert.equal(count(report.rows, "duplicate"), 1);
  assert.equal(cards[0]!.reviews.length, 2);
});

test("cards with fewer than 2 rated reviews are dropped and counted as cards", () => {
  const events = [
    created("a"),
    created("single"),
    graded("g1", "a", { grade: 3 }),
    graded("g2", "a", { grade: 3 }),
    graded("g3", "single", { grade: 4, overridden: true }),
  ];
  const { cards, report } = run(events);
  assert.equal(count(report.rows, "shortCard"), 1);
  assert.equal(cards.length, 1);
  assert.equal(report.includedReviews, 2);
  // The dropped card's override mark must not leak into the included count.
  assert.equal(report.overriddenIncluded, 0);
});

test("overridden reviews are included and counted", () => {
  const events = [
    created("a"),
    graded("g1", "a", { grade: 3 }),
    graded("g2", "a", { grade: 2, overridden: true }),
  ];
  const { cards, report } = run(events);
  assert.equal(report.overriddenIncluded, 1);
  assert.equal(cards[0]!.reviews[1]!.overridden, true);
});

test("fitTier mirrors the fsrs-rs tiers and the 400-review confidence line", () => {
  const mk = (cards: number, reviews: number) => ({
    rows: [],
    includedCards: cards,
    includedReviews: reviews,
    overriddenIncluded: 0,
  });
  assert.deepEqual(fitTier(mk(7, 14)), { tier: "none", lowData: true });
  assert.deepEqual(fitTier(mk(8, 16)), { tier: "pretrain", lowData: true });
  assert.deepEqual(fitTier(mk(64, 399)), { tier: "full", lowData: true });
  assert.deepEqual(fitTier(mk(64, 400)), { tier: "full", lowData: false });
});

test("report: zero-count reasons are omitted, non-zero rendered with labels", () => {
  const events = [
    created("a"),
    graded("old", "a", {}),
    graded("g1", "a", { grade: 3 }),
    graded("g2", "a", { grade: 3 }),
  ];
  const text = formatDataReport(run(events), NOW);
  assert.match(text, /2 rated reviews on 1 card\b/);
  assert.match(
    text,
    new RegExp(EXCLUSION_LABELS.noRating.replace(/[()]/g, "\\$&")),
  );
  assert.doesNotMatch(text, /Duplicate event/);
  assert.doesNotMatch(text, /Review undone/);
  assert.match(text, /a fit today returns the defaults/);
  assert.match(text, /Rating logging started in 0\.7\.15/);
});

test("report is deterministic for the same input", () => {
  const events = [
    created("a"),
    graded("g1", "a", { grade: 3 }),
    graded("g2", "a", { grade: 4, overridden: true }),
  ];
  const one = formatDataReport(run(events), NOW);
  const two = formatDataReport(run(events), NOW);
  assert.equal(one, two);
});

test("empty log produces the calm empty report, not a crash", () => {
  const text = formatDataReport(run([]), NOW);
  assert.match(text, /0 rated reviews on 0 cards/);
  assert.match(text, /## Excluded\n\nNone\./);
});
