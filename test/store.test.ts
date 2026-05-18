/**
 * Golden contract for src/ir/store.ts (Q2 D, store IO half).
 *
 * Claude-authored, fenced out of the delegated scope. The oracle is an
 * in-memory VaultFs defined here: deterministic, no real filesystem. opencode
 * implements src/ir/store.ts from TASK.md and is judged by this suite + tsc.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IrStore, type VaultFs } from "../src/ir/store";
import type { IrEvent } from "../src/ir/model";
import { newElement } from "../src/ir/model";
import { newElementId, newEventId, newDeviceId, type ElementId } from "../src/ir/ids";

/** Minimal in-memory VaultFs. Paths are plain strings; dirs are implicit. */
function memFs(): VaultFs & { dump(): Map<string, string> } {
  const files = new Map<string, string>();
  return {
    dump: () => files,
    async exists(p) {
      return files.has(p);
    },
    async read(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async write(p, data) {
      files.set(p, data);
    },
    async append(p, data) {
      files.set(p, (files.get(p) ?? "") + data);
    },
    async list(dir) {
      const pre = dir.endsWith("/") ? dir : dir + "/";
      const out: string[] = [];
      for (const k of files.keys()) {
        if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(k);
      }
      return out;
    },
  };
}

function gradeEvent(target: ElementId, lamport: number, due: number, device = newDeviceId()): IrEvent {
  return {
    id: newEventId(),
    ts: lamport * 1000,
    lamport,
    device,
    kind: "graded",
    target,
    payload: { card: { due, stability: 1, difficulty: 5, elapsedDays: 0, scheduledDays: 1, reps: 1, lapses: 0, state: 2 } },
  };
}

function createEvent(id: ElementId, lamport: number): IrEvent {
  return {
    id: newEventId(),
    ts: lamport * 1000,
    lamport,
    device: newDeviceId(),
    kind: "element-created",
    target: id,
    payload: { element: newElement({ id, type: "item", priority: 50, now: 0 }) },
  };
}

test("init creates schema meta v1 and a device id", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  assert.equal(await store.schemaVersion(), 1);
  const dev = await store.getDeviceId();
  assert.match(dev, /^dev_/);
});

test("device id is stable across init calls and store instances", async () => {
  const fs = memFs();
  const a = new IrStore(fs);
  await a.init();
  const d1 = await a.getDeviceId();
  await a.init(); // second init must not regenerate
  assert.equal(await a.getDeviceId(), d1);

  const b = new IrStore(fs); // different instance, same fs
  await b.init();
  assert.equal(await b.getDeviceId(), d1);
});

test("appendEvent appends lines to this device's shard, never overwrites", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const dev = await store.getDeviceId();

  const id = newElementId();
  await store.appendEvent(createEvent(id, 1));
  await store.appendEvent(gradeEvent(id, 2, 5000, dev));

  const shardPath = `.ir/log/${dev}.jsonl`;
  const raw = await fs.read(shardPath);
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 2);
  for (const l of lines) JSON.parse(l); // each line is valid JSON
});

test("load with no shards returns an empty state", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const s = await store.load();
  assert.equal(s.elements.size, 0);
  assert.equal(s.tombstones.size, 0);
});

test("load folds events across all device shards", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const id = newElementId();

  await store.appendEvent(createEvent(id, 1));
  await store.appendEvent(gradeEvent(id, 2, 7000, await store.getDeviceId()));

  // A shard that arrived from another device via Sync.
  const otherDev = newDeviceId();
  const foreign = gradeEvent(id, 3, 4000, otherDev);
  await fs.write(`.ir/log/${otherDev}.jsonl`, JSON.stringify(foreign) + "\n");

  const s = await store.load();
  const el = s.elements.get(id);
  assert.ok(el);
  // Default conflict is conservative: earlier due (4000) wins over 7000.
  assert.equal(el.card?.due, 4000);
});

test("conflict option threads into the fold on load", async () => {
  const fs = memFs();
  const store = new IrStore(fs, { conflict: "clock-order" });
  await store.init();
  const id = newElementId();

  await store.appendEvent(createEvent(id, 1));
  await store.appendEvent(gradeEvent(id, 2, 4000, await store.getDeviceId()));

  const otherDev = newDeviceId();
  await fs.write(
    `.ir/log/${otherDev}.jsonl`,
    JSON.stringify(gradeEvent(id, 3, 9000, otherDev)) + "\n",
  );

  const s = await store.load();
  // clock-order: highest lamport (3 -> due 9000) wins.
  assert.equal(s.elements.get(id)?.card?.due, 9000);
});

test("malformed shard lines are skipped, not fatal", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const id = newElementId();
  await store.appendEvent(createEvent(id, 1));

  const otherDev = newDeviceId();
  await fs.write(
    `.ir/log/${otherDev}.jsonl`,
    "not json\n" + JSON.stringify(gradeEvent(id, 2, 1234, otherDev)) + "\n\n",
  );

  const s = await store.load();
  assert.equal(s.elements.get(id)?.card?.due, 1234);
});
