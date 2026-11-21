import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAdvanceEvents,
  parseAdvanceInput,
  parseJumpIntervalInput,
  planAdvanceElements,
  planManualSchedule,
} from "../src/ir/manual-schedule";
import { readCoreSearchMatchedPaths } from "../src/ir/search-view";
import { fold } from "../src/ir/log";
import { computeElementHistoryCounts } from "../src/ir/mercy";
import { SM20_MAX_INTERVAL_DAYS } from "../src/sm18-ir-mechanics";
import { newElement } from "../src/ir/model";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";

test("manual item reschedule changes due and interval without review state", () => {
  const element = newElement({ id: "item" as ElementId, type: "item", priority: 50, now: 0 });
  element.card = { due: 1, stability: 2, difficulty: 3, elapsedDays: 4,
    scheduledDays: 8, reps: 9, lapses: 1, state: 2 };
  const plan = planManualSchedule(element, 100, 4, 1)!;
  assert.equal(plan.card?.due, 100);
  assert.equal(plan.card?.scheduledDays, 4);
  assert.equal(plan.card?.reps, 9);
  assert.ok(plan.priorityAfter < plan.priorityBefore);
});

test("manual reading reschedule preserves base A-Factor", () => {
  const element = newElement({ id: "topic" as ElementId, type: "topic", priority: 50, now: 0 });
  element.schedule = { due: 1, interval: 8, aFactor: 2.4 };
  const plan = planManualSchedule(element, 100, 16, 1)!;
  assert.equal(plan.schedule?.aFactor, 2.4);
  assert.equal(plan.schedule?.interval, 16);
  assert.ok(plan.priorityAfter > plan.priorityBefore);
});

test("parseJumpIntervalInput parses day counts and YYYY-MM-DD dates", () => {
  const now = new Date(2026, 10, 19, 10, 0, 0).getTime();
  const byDays = parseJumpIntervalInput("14", now);
  assert.equal(byDays?.intervalDays, 14);

  const byDate = parseJumpIntervalInput("2026-11-29", now);
  assert.equal(byDate?.intervalDays, 10);

  assert.equal(parseJumpIntervalInput("0", now), null);
  assert.equal(parseJumpIntervalInput("2026-11-18", now), null);
  assert.equal(parseJumpIntervalInput("not-a-date", now), null);

  const farFuture = parseJumpIntervalInput("9999-12-31", now);
  assert.ok(farFuture);
  assert.equal(farFuture.intervalDays, SM20_MAX_INTERVAL_DAYS);
  const maxExpectedYear = new Date(now).getFullYear() + Math.ceil(SM20_MAX_INTERVAL_DAYS / 365) + 1;
  assert.ok(new Date(farFuture.dueMs).getFullYear() <= maxExpectedYear);
});

test("JumpInterval adjusts topic A-Factor via adjustTopicAFactor and optionally disperses", () => {
  const element = newElement({ id: "topic2" as ElementId, type: "topic", priority: 50, now: 0 });
  element.schedule = { due: 1, interval: 4, aFactor: 2.0 };
  const jumpedUp = planManualSchedule(element, 100 * 86_400_000, 100, {
    nowMs: 0,
    adjustAFactor: true,
  })!;
  assert.ok(jumpedUp.schedule!.aFactor > 2.0);

  const dispersed = planManualSchedule(element, 100 * 86_400_000, 100, {
    nowMs: 0,
    disperseRng: () => 0.9,
  })!;
  assert.ok(dispersed.newInterval !== 100);
});

test("parseAdvanceInput parses today/0 and positive day counts", () => {
  assert.equal(parseAdvanceInput(""), 0);
  assert.equal(parseAdvanceInput("0"), 0);
  assert.equal(parseAdvanceInput("Today"), 0);
  assert.equal(parseAdvanceInput("7"), 7);
  assert.equal(parseAdvanceInput("999999"), SM20_MAX_INTERVAL_DAYS);
  assert.equal(parseAdvanceInput("-3"), null);
  assert.equal(parseAdvanceInput("abc"), null);
});

test("planAdvanceElements spreads in priority order, preserves lastReview/stability, and adds zero mercy count", () => {
  const now = 1_760_000_000_000;
  const dayMs = 86_400_000;
  const lowPri = newElement({ id: "el-low" as ElementId, type: "item", priority: 60, now: 0 });
  lowPri.card = {
    due: now + 90 * dayMs,
    stability: 42,
    difficulty: 4.5,
    elapsedDays: 20,
    scheduledDays: 90,
    reps: 5,
    lapses: 0,
    state: 2,
    lastReview: now - 10 * dayMs,
  };
  const highPri = newElement({ id: "el-high" as ElementId, type: "topic", priority: 10, now: 0 });
  highPri.schedule = { due: now + 30 * dayMs, interval: 30, aFactor: 2.3 };
  const dismissed = newElement({ id: "el-dis" as ElementId, type: "topic", priority: 5, now: 0 });
  dismissed.dismissed = true;
  dismissed.schedule = { due: now + 5 * dayMs, interval: 5, aFactor: 2.0 };

  const entries = planAdvanceElements([lowPri, highPri, dismissed], 2, now);
  assert.equal(entries.length, 2);
  assert.equal(entries[0]!.elementId, highPri.id);
  assert.equal(entries[0]!.dayOffset, 0);
  assert.equal(entries[1]!.elementId, lowPri.id);
  assert.equal(entries[1]!.dayOffset, 1);
  assert.equal(entries[1]!.card?.stability, 42);
  assert.equal(entries[1]!.card?.lastReview, now - 10 * dayMs);

  let seq = 1;
  const createdEvents = [lowPri, highPri].map((el, i) => ({
    id: `c-${i}` as EventId,
    ts: 0,
    lamport: i + 1,
    device: "dev-a" as DeviceId,
    kind: "element-created" as const,
    target: el.id,
    payload: { element: el },
  }));
  const advEvents = buildAdvanceEvents(entries, {
    nowMs: now,
    lamportStart: 10,
    deviceId: "dev-a" as DeviceId,
    batchId: "adv-batch-1",
    newEventId: () => `adv-${seq++}` as EventId,
  });

  const allEvents = [...createdEvents, ...advEvents];
  const folded = fold(allEvents);
  assert.equal(folded.elements.get(highPri.id)?.schedule?.due, now);
  assert.equal(folded.elements.get(highPri.id)?.schedule?.aFactor, 2.3);
  assert.equal(folded.elements.get(lowPri.id)?.card?.due, now + dayMs);
  assert.equal(folded.elements.get(lowPri.id)?.card?.stability, 42);

  const counts = computeElementHistoryCounts(allEvents);
  assert.equal(counts.get(highPri.id)?.totalPostponeCount ?? 0, 0);
  assert.equal(counts.get(lowPri.id)?.totalPostponeCount ?? 0, 0);
});

test("readCoreSearchMatchedPaths reads resultDomLookup Map and DOM .tree-item-self fallback", () => {
  const fakeAppMap = {
    workspace: {
      getLeavesOfType: (t: string) =>
        t === "search"
          ? [
              {
                view: {
                  dom: {
                    resultDomLookup: new Map([[{ path: "Notes/A.md" }, {}], [{ path: "Notes/B.md" }, {}]]),
                  },
                },
              },
            ]
          : [],
    },
  };
  assert.deepEqual(readCoreSearchMatchedPaths(fakeAppMap as never), ["Notes/A.md", "Notes/B.md"]);

  const fakeAppDom = {
    workspace: {
      getLeavesOfType: () => [
        {
          view: {
            containerEl: {
              querySelectorAll: () => [
                { getAttribute: (n: string) => (n === "data-path" ? "Notes/C.md" : null) },
                { getAttribute: () => null, querySelector: () => ({ textContent: "Notes/D.md" }) },
              ],
            },
          },
        },
      ],
    },
    metadataCache: {
      getFirstLinkpathDest: (link: string) => (link === "Notes/D.md" ? { path: "Notes/D.md" } : null),
    },
    vault: { getFiles: () => [] },
  };
  assert.deepEqual(readCoreSearchMatchedPaths(fakeAppDom as never), ["Notes/C.md", "Notes/D.md"]);
});
