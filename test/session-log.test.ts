import { test } from "node:test";
import assert from "node:assert/strict";
import {
  actionLabel,
  sessionEntries,
} from "../src/ir/session-log";
import type { IrElement, IrEvent, IrEventKind } from "../src/ir/model";
import type { ElementId, EventId, DeviceId } from "../src/ir/ids";

const NOW = 1_000_000;

function ev(p: {
  id: string;
  ts: number;
  kind: IrEventKind;
  target: string;
}): IrEvent {
  return {
    id: p.id as EventId,
    ts: p.ts,
    lamport: p.ts,
    device: "dev" as DeviceId,
    kind: p.kind,
    target: p.target as ElementId,
    payload: {},
  };
}

function el(id: string, notePath?: string): IrElement {
  return {
    id: id as ElementId,
    type: "topic",
    priority: 50,
    parentId: null,
    dismissed: false,
    created: 0,
    text: "",
    anchorState: "ok",
    notePath,
  };
}

test("actionLabel maps kinds to user-readable strings", () => {
  assert.equal(actionLabel("graded"), "graded");
  assert.equal(actionLabel("topic-advanced"), "advanced");
  assert.equal(actionLabel("mercy-postponed"), "mercy postponed");
  assert.equal(actionLabel("source-tombstoned"), "source removed");
});

test("sessionEntries: excludes events before sessionStart", () => {
  const byId = new Map([[el("a").id, el("a")]]);
  const entries = sessionEntries(
    [
      ev({ id: "e1", ts: NOW - 1, kind: "graded", target: "a" }),
      ev({ id: "e2", ts: NOW, kind: "graded", target: "a" }),
      ev({ id: "e3", ts: NOW + 100, kind: "topic-advanced", target: "a" }),
    ],
    byId,
    NOW,
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["topic-advanced", "graded"],
  );
});

test("sessionEntries: newest first", () => {
  const byId = new Map([[el("a").id, el("a")]]);
  const entries = sessionEntries(
    [
      ev({ id: "e1", ts: NOW + 10, kind: "graded", target: "a" }),
      ev({ id: "e2", ts: NOW + 30, kind: "topic-advanced", target: "a" }),
      ev({ id: "e3", ts: NOW + 20, kind: "priority-set", target: "a" }),
    ],
    byId,
    NOW,
  );
  assert.deepEqual(
    entries.map((e) => e.kind),
    ["topic-advanced", "priority-set", "graded"],
  );
});

test("sessionEntries: missing element falls back to raw id", () => {
  const byId = new Map<string, IrElement>();
  const entries = sessionEntries(
    [ev({ id: "e1", ts: NOW + 1, kind: "graded", target: "ghost-id" })],
    byId,
    NOW,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, "ghost-id");
  assert.equal(entries[0].notePath, undefined);
});

test("sessionEntries: notePath surfaces from element", () => {
  const a = el("a", "Notes/A.md");
  const byId = new Map([[a.id, a]]);
  const entries = sessionEntries(
    [ev({ id: "e1", ts: NOW + 1, kind: "graded", target: "a" })],
    byId,
    NOW,
  );
  assert.equal(entries[0].notePath, "Notes/A.md");
  assert.equal(entries[0].label, "A");
});
