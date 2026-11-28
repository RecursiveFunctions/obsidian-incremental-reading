/**
 * Regression tests for the smdecomp-reported bugs #127-#129, #133-#137:
 * audit counter drift on imported collections, remote images leaking into
 * imported bodies, corrupt hand-edited card state, stale record-note ids,
 * bibliography frontmatter wiping ledger references, UI-blocking simulator,
 * and DST-shifted day buckets.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// #137 needs a DST-observing zone; must run before any day-bucket call.
process.env.TZ = "America/New_York";

import { auditAndRepairCollectionIntegrity } from "../src/ir/sm20-collection-ops";
import { newElement, type IrElement, type IrEvent } from "../src/ir/model";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import {
  htmlToMarkdown,
  stripRemoteMarkdownImages,
} from "../src/ir/html-to-markdown";
import { parseSuperMemoQaText } from "../src/ir/sm20-exchange";
import {
  readCardFromFrontmatter,
  schedule,
  storedToCard,
} from "../src/fsrs";
import {
  createEmptyConceptRegistry,
  reconcileNoteFrontmatterWithLedger,
} from "../src/ir/concepts-references";
import {
  simulateLongHorizonWorkload,
  simulateLongHorizonWorkloadAsync,
} from "../src/ir/sm20-analytics";
import { buildRecordedNoteEvents } from "../src/ir/record-note";
import { elementIdForPath } from "../src/ir/migrate";
import { IR_KEYS } from "../src/types";

const NOW = 1_760_000_000_000;
const DAY = 86_400_000;
const DEV = newDeviceId();

// --- #127: imported graded events carry cumulative card snapshots ---------

test("audit treats cumulative graded snapshots as authoritative; no phantom drift or backdating (#127)", () => {
  const id = newElementId();
  const finalCard = {
    due: NOW + 3 * DAY,
    stability: 10,
    difficulty: 6,
    elapsedDays: 30,
    scheduledDays: 3,
    reps: 2463,
    lapses: 12,
    state: 2,
    lastReview: NOW - 3 * DAY,
  };
  const el: IrElement = {
    ...newElement({ id, type: "item", priority: 50, now: NOW }),
    card: finalCard,
  };
  const events: IrEvent[] = [
    {
      id: newEventId(),
      ts: NOW - 30 * DAY,
      lamport: 1,
      device: DEV,
      kind: "element-created",
      target: id,
      payload: { element: el },
    },
  ];
  for (let i = 1; i <= 5; i += 1) {
    events.push({
      id: newEventId(),
      ts: NOW - (6 - i) * DAY,
      lamport: 1 + i,
      device: DEV,
      kind: "graded",
      target: id,
      payload: {
        card: {
          ...finalCard,
          reps: Math.floor((finalCard.reps / 5) * i),
          lastReview: NOW - (6 - i) * DAY,
        },
        grade: 3,
        smGrade: 4,
      },
    });
  }

  const report = auditAndRepairCollectionIntegrity({
    elements: new Map([[id, el]]),
    events,
    nowMs: NOW,
    device: DEV,
    startingLamport: 100,
  });

  // The element-created card is pre-state (later wall-clock than the graded
  // snapshots that overwrite it) and each snapshot's reps is cumulative:
  // counting one rep per event used to derive 2463 + 5 and flag both a
  // phantom drift and a phantom backward timestamp.
  assert.equal(report.counts.cardCounterDrifts, 0);
  assert.equal(report.counts.historyAnomalies, 0);
  assert.equal(
    report.repairEvents.filter((ev) => ev.kind === "card-reset").length,
    0,
  );
});

test("audit still reports drift when the latest snapshot disagrees with the element card (#127)", () => {
  const id = newElementId();
  const el: IrElement = {
    ...newElement({ id, type: "item", priority: 50, now: NOW }),
    card: {
      due: NOW + DAY,
      stability: 5,
      difficulty: 5,
      elapsedDays: 5,
      scheduledDays: 5,
      reps: 77,
      lapses: 3,
      state: 2,
      lastReview: NOW - DAY,
    },
  };
  const report = auditAndRepairCollectionIntegrity({
    elements: new Map([[id, el]]),
    events: [
      {
        id: newEventId(),
        ts: NOW - 2 * DAY,
        lamport: 1,
        device: DEV,
        kind: "graded",
        target: id,
        payload: {
          card: { ...el.card!, reps: 40 },
          grade: 3,
          smGrade: 4,
        },
      },
    ],
    nowMs: NOW,
    device: DEV,
    startingLamport: 100,
  });
  assert.equal(report.counts.cardCounterDrifts, 1);
  assert.ok(
    report.repairEvents.some((ev) => ev.kind === "card-reset"),
    "drift should emit a card-reset repair",
  );
});

// --- #128: remote images must not survive import --------------------------

test("stripRemoteMarkdownImages keeps vault-relative and wikilink embeds, drops remote URLs (#128)", () => {
  assert.equal(
    stripRemoteMarkdownImages("see ![flag](https://ex.com/f.png) here"),
    "see flag here",
  );
  assert.equal(stripRemoteMarkdownImages('![a](http://x/a.png "t")'), "a");
  assert.equal(stripRemoteMarkdownImages("![a](//cdn.example.com/a.png)"), "a");
  assert.equal(stripRemoteMarkdownImages("![a](ftp://h/a.png)"), "a");
  assert.equal(stripRemoteMarkdownImages("![a](<https://h/a b.png>)"), "a");
  assert.equal(
    stripRemoteMarkdownImages("![a](images/a.png)"),
    "![a](images/a.png)",
  );
  assert.equal(
    stripRemoteMarkdownImages("![a](./notes/img/a.png)"),
    "![a](./notes/img/a.png)",
  );
  assert.equal(
    stripRemoteMarkdownImages("![[Pasted image.png]]"),
    "![[Pasted image.png]]",
  );
  assert.equal(
    stripRemoteMarkdownImages("a [link](https://ex.com) stays"),
    "a [link](https://ex.com) stays",
  );
});

test("htmlToMarkdown strips pre-markdown'd remote image embeds (#128)", () => {
  const md = htmlToMarkdown(
    "<p>Text ![pic](https://ex.com/p.png) tail <img src=\"https://ex.com/q.png\"></p>",
  );
  assert.ok(!md.includes("https://ex.com"), md);
  assert.ok(md.includes("pic"));
});

test("plain-text Q&A import strips remote markdown images (#128)", () => {
  const res = parseSuperMemoQaText(
    "Q: Capital? ![flag](https://ex.com/f.png)\nA: Paris",
    NOW,
    DEV,
  );
  const json = JSON.stringify(res);
  assert.ok(!json.includes("ex.com"), json);
  assert.ok(json.includes("flag"));
  assert.ok(json.includes("Paris"));
});

// --- #129: corrupt card state must not brick grading ----------------------

test("hand-edited or corrupt card state is repaired at deserialization (#129)", () => {
  const when = new Date(NOW);
  const corrupt: Array<Record<string, unknown>> = [
    { [IR_KEYS.stability]: 0, [IR_KEYS.difficulty]: 0, [IR_KEYS.state]: 2, [IR_KEYS.reps]: 5 },
    { [IR_KEYS.stability]: -5, [IR_KEYS.difficulty]: 99, [IR_KEYS.state]: 2, [IR_KEYS.reps]: 5 },
    { [IR_KEYS.stability]: 1e12, [IR_KEYS.difficulty]: 5, [IR_KEYS.state]: 3, [IR_KEYS.reps]: 5 },
    { [IR_KEYS.stability]: 5, [IR_KEYS.difficulty]: 5, [IR_KEYS.state]: 42, [IR_KEYS.reps]: 5 },
    { [IR_KEYS.stability]: 5, [IR_KEYS.difficulty]: 5, [IR_KEYS.state]: 2, [IR_KEYS.reps]: -3 },
  ];
  for (const fm of corrupt) {
    const card = readCardFromFrontmatter(fm);
    const next = schedule(card, "good", when);
    assert.ok(Number.isFinite(next.stability) && next.stability > 0);
    assert.ok(next.difficulty >= 1 && next.difficulty <= 10);
  }

  const stored = storedToCard({
    due: NOW,
    stability: 0,
    difficulty: 0,
    elapsedDays: 4,
    scheduledDays: 4,
    reps: 9,
    lapses: 1,
    state: 2,
    lastReview: NOW - DAY,
  });
  const next = schedule(stored, "good", when);
  assert.ok(next.reps >= 1);
});

// --- #133 (unit): stale deterministic ids vs checkpointed history ---------

test("buildRecordedNoteEvents mints fresh ids when the deterministic id is checkpoint-covered (#133)", () => {
  const path = "IR/Stale.md";
  const fm = { path, frontmatter: { [IR_KEYS.type]: "item", [IR_KEYS.priority]: 35 } };
  const first = buildRecordedNoteEvents(fm, NOW, {
    liveElements: [],
    historicalEvents: [],
  });
  const firstEventId = first.events[0]!.id;
  const second = buildRecordedNoteEvents(fm, NOW + 1, {
    liveElements: [],
    historicalEvents: [],
    coveredEventIds: { has: (id) => id === firstEventId },
  });
  assert.notEqual(second.events[0]!.id, firstEventId);
  assert.ok(second.element);
  assert.notEqual(second.element.id, first.element!.id);
});

// --- #134: bibliography frontmatter merges, never wipes -------------------

test("generic bibliography frontmatter fills over the ledger reference (#134)", () => {
  const el: IrElement = {
    ...newElement({ id: newElementId(), type: "extract", priority: 30, now: NOW }),
    reference: {
      author: "Smith",
      title: "Deep Medicine",
      source: "Journal X",
      link: "https://ex.com/dm",
    },
  };
  const merged = reconcileNoteFrontmatterWithLedger(
    el,
    { date: "2020", author: "S. Smith" },
    createEmptyConceptRegistry(),
    NOW + 1,
  );
  assert.ok(merged.reference);
  assert.equal(merged.reference.title, "Deep Medicine");
  assert.equal(merged.reference.source, "Journal X");
  assert.equal(merged.reference.link, "https://ex.com/dm");
  assert.equal(merged.reference.date, "2020");
  assert.equal(merged.reference.author, "S. Smith");

  const explicit = reconcileNoteFrontmatterWithLedger(
    el,
    { ir_ref: { author: "Only" } },
    createEmptyConceptRegistry(),
    NOW + 2,
  );
  assert.equal(explicit.reference?.author, "Only");
  assert.ok(!explicit.reference?.title, "explicit ir_ref stays authoritative (full replace)");
});

// --- #135: inline-code fences grow past embedded backticks ----------------

test("inline code fence length follows the longest backtick run (#135)", () => {
  assert.match(htmlToMarkdown("<p><code>plain</code></p>"), /`plain`/);
  assert.match(htmlToMarkdown("<p><code>a `` b</code></p>"), /```a `` b```/);
  assert.match(htmlToMarkdown("<p><code>`tick</code></p>"), /`` `tick ``/);
  assert.match(
    htmlToMarkdown("<p><code>&#96;&#96;&#96;</code></p>"),
    /```` ``` ````/,
  );
});

// --- #136: long-horizon simulator must not block the UI -------------------

test("async simulator equals the sync run and honours abort (#136)", async () => {
  const elements: IrElement[] = [];
  for (let i = 0; i < 40; i += 1) {
    elements.push(newElement({ id: newElementId(), type: "item", priority: 10 + i, now: NOW }));
  }
  const input = {
    elements,
    nowMs: NOW,
    horizonDays: 60,
    dailyCapacity: 20,
    newItemsPerDay: 5,
    desiredRetention: 0.9,
    scheduler: "sm20" as const,
    seed: 42,
  };
  const sync = simulateLongHorizonWorkload(input);
  const progress: number[] = [];
  const stepped = await simulateLongHorizonWorkloadAsync(input, {
    chunkMs: 1,
    onProgress: (done) => progress.push(done),
  });
  assert.deepEqual(stepped, sync);
  assert.ok(progress.length > 1, "bursting should have yielded more than once");
  const aborted = await simulateLongHorizonWorkloadAsync(input, {
    shouldAbort: () => true,
  });
  assert.equal(aborted, undefined);
});

// --- #137: DST-safe local day buckets -------------------------------------

test("day bucketing survives DST transitions (#137)", async () => {
  const stats = await import("../src/ir/stats");

  // Spring forward (2026-03-08 in America/New_York): Mar 7 -> Mar 9 is two
  // calendar days but only 47 wall-clock hours.
  const mar7 = new Date(2026, 2, 7).getTime();
  assert.equal(stats.localDayIndexSince(new Date(2026, 2, 8, 12).getTime(), mar7), 1);
  assert.equal(stats.localDayIndexSince(new Date(2026, 2, 9, 0, 30).getTime(), mar7), 2);

  // Fall back (2026-11-01): Oct 31 -> Nov 2 is two calendar days but 49 hours.
  const oct31 = new Date(2026, 9, 31).getTime();
  assert.equal(stats.localDayIndexSince(new Date(2026, 10, 1).getTime(), oct31), 1);
  assert.equal(stats.localDayIndexSince(new Date(2026, 10, 2, 0, 30).getTime(), oct31), 2);

  const grades = [
    { ts: new Date(2026, 2, 7, 12).getTime(), grade: 3 },
    { ts: new Date(2026, 2, 8, 12).getTime(), grade: 3 },
    { ts: new Date(2026, 2, 9, 0, 30).getTime(), grade: 3 },
  ];
  const now = new Date(2026, 2, 9, 12).getTime();
  assert.deepEqual(stats.gradeSpark(grades, now, 3), [1, 1, 1]);
});
