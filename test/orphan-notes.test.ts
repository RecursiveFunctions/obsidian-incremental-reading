import { test } from "node:test";
import assert from "node:assert/strict";
import {
  knownNotePathsFromEvents,
  lastIdForNotePath,
  matchMovedFrom,
  orphanNotes,
  planOrphanRecoveries,
  storeNotePaths,
} from "../src/ir/orphan-notes";
import { elementIdForPath, migrateNotes } from "../src/ir/migrate";
import { fold } from "../src/ir/log";
import { newElement, type IrElement, type IrEvent } from "../src/ir/model";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";
import { IR_KEYS } from "../src/types";
import { planSourceDeletion } from "../src/ir/deletion";

const DEV = "dev_test" as DeviceId;
const NOW = 1_700_000_000_000;

function ids(): { n: number; next: () => EventId } {
  let n = 0;
  return {
    n: 0,
    next: () => {
      n += 1;
      return `ev_orphan_${n}` as EventId;
    },
  };
}

function topicFm(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [IR_KEYS.type]: "topic",
    [IR_KEYS.priority]: 20,
    [IR_KEYS.due]: "2026-01-01T00:00:00.000Z",
    [IR_KEYS.interval]: 3,
    [IR_KEYS.aFactor]: 2,
    ...extra,
  };
}

function extractFm(parent: string): Record<string, unknown> {
  return {
    [IR_KEYS.type]: "extract",
    [IR_KEYS.priority]: 35,
    [IR_KEYS.parent]: parent,
    [IR_KEYS.due]: "2026-02-02T00:00:00.000Z",
    [IR_KEYS.interval]: 4,
    [IR_KEYS.aFactor]: 2,
  };
}

function created(
  el: IrElement,
  lamport: number,
  id = `ev_c_${el.id}` as EventId,
): IrEvent {
  return {
    id,
    ts: NOW,
    lamport,
    device: DEV,
    kind: "element-created",
    target: el.id,
    payload: { element: el },
  };
}

test("orphanNotes: disk IR notes whose path is not any store notePath", () => {
  const live = [
    newElement({
      id: "el_a" as ElementId,
      type: "topic",
      priority: 50,
      notePath: "Keep/a.md",
      now: 0,
    }),
  ];
  const notes = [
    { path: "Keep/a.md", frontmatter: topicFm() },
    { path: "Archive/Papers/b.md", frontmatter: topicFm() },
  ];
  assert.deepEqual(
    orphanNotes(notes, live).map((n) => n.path),
    ["Archive/Papers/b.md"],
  );
  assert.deepEqual([...storeNotePaths(live)], ["Keep/a.md"]);
});

test("lastIdForNotePath follows create then rename", () => {
  const id = "el_uuid" as ElementId;
  const events: IrEvent[] = [
    created(
      newElement({
        id,
        type: "topic",
        priority: 50,
        notePath: "Old/a.md",
        now: 0,
      }),
      1,
    ),
    {
      id: "ev_ren" as EventId,
      ts: NOW,
      lamport: 2,
      device: DEV,
      kind: "source-renamed",
      target: id,
      payload: { oldPath: "Old/a.md", newPath: "New/a.md" },
    },
  ];
  assert.equal(lastIdForNotePath(events, "Old/a.md"), id);
  assert.equal(lastIdForNotePath(events, "New/a.md"), id);
  assert.equal(lastIdForNotePath(events, "Other.md"), null);
});

test("matchMovedFrom: folder suffix, unique basename, prefix", () => {
  assert.equal(
    matchMovedFrom(
      "Archive/Papers/a.md",
      ["Papers/a.md", "Papers/b.md"],
      ["Archive/Papers/a.md", "Archive/Papers/b.md"],
    ),
    "Papers/a.md",
  );
  assert.equal(
    matchMovedFrom("Else/a.md", ["Old/a.md"], ["Else/a.md", "Else/b.md"]),
    "Old/a.md",
  );
  assert.equal(
    matchMovedFrom(
      "Archive/Papers/a.md",
      ["Papers/a.md", "Papers/b.md"],
      ["Archive/Papers/a.md", "Archive/Papers/b.md"],
      ["Papers/a.md"],
    ),
    "Papers/a.md",
  );
});

test("planOrphanRecoveries: resurrect deleted folder-move notes with old ids", () => {
  const oldTopic = "Papers/a.md";
  const oldExtract = "Papers/ex.md";
  const newTopic = "Archive/Papers/a.md";
  const newExtract = "Archive/Papers/ex.md";
  const topicId = elementIdForPath(oldTopic);
  const extractId = elementIdForPath(oldExtract);

  const topicEl = newElement({
    id: topicId,
    type: "topic",
    priority: 20,
    parentId: null,
    notePath: oldTopic,
    now: 0,
  });
  const extractEl = newElement({
    id: extractId,
    type: "extract",
    priority: 35,
    parentId: topicId,
    notePath: oldExtract,
    now: 0,
  });
  const highlight = newElement({
    id: "el_hl" as ElementId,
    type: "extract",
    priority: 40,
    parentId: topicId,
    anchor: {
      sourcePath: oldTopic,
      quote: { exact: "q", prefix: "", suffix: "" },
      position: { start: 0, end: 1 },
    },
    now: 0,
  });

  const createEvents = [
    created(topicEl, 1),
    created(extractEl, 2),
    created(highlight, 3),
  ];
  const liveBefore = fold(createEvents).elements;
  const delTopic = planSourceDeletion(
    Array.from(liveBefore.values()),
    oldTopic,
    "a",
    NOW,
    4,
    DEV,
    (i) => `ev_del_t_${i}` as EventId,
    () => "IR/Promoted.md",
    { autoPromoteRootless: false },
  );
  const afterTopic = fold([...createEvents, ...delTopic]);
  const delExtract = planSourceDeletion(
    Array.from(afterTopic.elements.values()),
    oldExtract,
    "ex",
    NOW,
    20,
    DEV,
    (i) => `ev_del_e_${i}` as EventId,
    () => "IR/Promoted.md",
    { autoPromoteRootless: false },
  );
  const events = [...createEvents, ...delTopic, ...delExtract];
  const state = fold(events);

  assert.equal(state.elements.has(topicId), false);
  assert.equal(state.elements.has(extractId), false);
  assert.equal(state.tombstones.has(oldTopic), true);

  const notes = [
    { path: newTopic, frontmatter: topicFm() },
    {
      path: newExtract,
      frontmatter: extractFm(oldTopic),
    },
  ];
  const vault = [newTopic, newExtract];
  const seq = ids();
  const plan = planOrphanRecoveries(
    notes,
    state.elements.values(),
    events,
    state.tombstones.keys(),
    vault,
    NOW,
    40,
    DEV,
    seq.next,
  );

  assert.ok(plan.restored >= 2);
  const recovered = fold([...events, ...plan.events]);
  const topic = recovered.elements.get(topicId);
  const extract = recovered.elements.get(extractId);
  assert.ok(topic, "topic is back under its original id");
  assert.ok(extract, "extract is back under its original id");
  assert.equal(topic!.notePath, newTopic);
  assert.equal(extract!.notePath, newExtract);
  assert.equal(extract!.parentId, topicId);
  assert.equal(recovered.tombstones.has(oldTopic), false);

  const hl = recovered.elements.get("el_hl" as ElementId);
  assert.ok(hl);
  assert.equal(hl!.anchor?.sourcePath, newTopic);
  assert.equal(hl!.anchorState, "ok");

  const freshId = elementIdForPath(newTopic);
  assert.notEqual(freshId, topicId);
  assert.equal(recovered.elements.has(freshId), false);

  const again = planOrphanRecoveries(
    notes,
    recovered.elements.values(),
    [...events, ...plan.events],
    recovered.tombstones.keys(),
    vault,
    NOW,
    80,
    DEV,
    ids().next,
  );
  assert.equal(again.events.length, 0);
  assert.equal(again.restored, 0);
});

test("planOrphanRecoveries: stale store path becomes source-renamed", () => {
  const oldPath = "Papers/a.md";
  const newPath = "Archive/Papers/a.md";
  const id = elementIdForPath(oldPath);
  const el = newElement({
    id,
    type: "topic",
    priority: 50,
    notePath: oldPath,
    now: 0,
  });
  const events = [created(el, 1)];
  const seq = ids();
  const plan = planOrphanRecoveries(
    [{ path: newPath, frontmatter: topicFm() }],
    [el],
    events,
    [],
    [newPath],
    NOW,
    2,
    DEV,
    seq.next,
  );
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0]!.kind, "source-renamed");
  assert.equal(plan.events[0]!.target, id);
  const state = fold([...events, ...plan.events]);
  assert.equal(state.elements.get(id)?.notePath, newPath);
});

test("planOrphanRecoveries: never-seen IR note is imported at the new path id", () => {
  const path = "Inbox/new.md";
  const seq = ids();
  const plan = planOrphanRecoveries(
    [{ path, frontmatter: topicFm() }],
    [],
    [],
    [],
    [path],
    NOW,
    1,
    DEV,
    seq.next,
  );
  assert.equal(plan.restored, 1);
  assert.equal(plan.events[0]!.kind, "element-created");
  assert.equal(plan.events[0]!.target, elementIdForPath(path));
  const mig = migrateNotes([{ path, frontmatter: topicFm() }], NOW);
  assert.equal(
    (plan.events[0]!.payload.element as IrElement).notePath,
    mig[0] && (mig[0].payload.element as IrElement).notePath,
  );
});

test("knownNotePathsFromEvents collects create, rename, tombstone", () => {
  const events: IrEvent[] = [
    created(
      newElement({
        id: "el_a" as ElementId,
        type: "topic",
        priority: 50,
        notePath: "A.md",
        now: 0,
      }),
      1,
    ),
    {
      id: "ev_t" as EventId,
      ts: NOW,
      lamport: 2,
      device: DEV,
      kind: "source-tombstoned",
      target: "el_a" as ElementId,
      payload: { tombstone: { path: "Gone.md", title: "Gone", deletedAt: NOW } },
    },
  ];
  const paths = knownNotePathsFromEvents(events).sort();
  assert.deepEqual(paths, ["A.md", "Gone.md"]);
});
