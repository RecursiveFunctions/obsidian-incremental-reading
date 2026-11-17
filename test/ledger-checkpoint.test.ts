/**
 * Fold-checkpoint contract for IrLedger (Q2 D: compaction that actually
 * bounds the read).
 *
 * The checkpoint is the fold's *intermediate* state plus a lamport watermark
 * and an id index. These tests pin the three properties that make it safe:
 *
 *  1. Folding a checkpoint plus the events it does not cover equals folding
 *     the complete stream (including priority placements and undos).
 *  2. The hot load path does not re-read compacted archives.
 *  3. Anything that breaks the lamport prefix — a torn checkpoint, a late
 *     foreign event, an undo of a folded grade — triggers a rebuild that
 *     still equals the complete fold.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IrLedger, COMPACTIONDIR, type VaultFs } from "../src/ir/ledger";
import {
  fold,
  foldFrom,
  foldIntermediate,
  finalizeFold,
} from "../src/ir/log";
import {
  newElement,
  type IrEvent,
  type IrEventKind,
} from "../src/ir/model";
import {
  newElementId,
  newEventId,
  newDeviceId,
  type ElementId,
  type DeviceId,
} from "../src/ir/ids";

const DAY = 86_400_000;

function memFs(): VaultFs & { dump(): Map<string, string>; reads: string[] } {
  const files = new Map<string, string>();
  const reads: string[] = [];
  return {
    dump: () => files,
    reads,
    async exists(p) {
      return files.has(p);
    },
    async read(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      reads.push(p);
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
    async remove(p) {
      files.delete(p);
    },
  };
}

function ev(p: {
  lamport: number;
  kind: IrEventKind;
  target: ElementId;
  payload?: Record<string, unknown>;
  device?: DeviceId;
  ts?: number;
}): IrEvent {
  return {
    id: newEventId(),
    ts: p.ts ?? p.lamport * 1000,
    lamport: p.lamport,
    device: p.device ?? newDeviceId(),
    kind: p.kind,
    target: p.target,
    payload: p.payload ?? {},
  };
}

function created(id: ElementId, lamport: number): IrEvent {
  return ev({
    lamport,
    kind: "element-created",
    target: id,
    payload: { element: newElement({ id, type: "item", priority: 50, now: 0 }) },
  });
}

function graded(id: ElementId, lamport: number, due: number): IrEvent {
  return ev({
    lamport,
    kind: "graded",
    target: id,
    payload: {
      card: {
        due,
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 1,
        reps: 1,
        lapses: 0,
        state: 2,
      },
    },
  });
}

function prio(id: ElementId, lamport: number, v: number): IrEvent {
  return ev({ lamport, kind: "priority-set", target: id, payload: { priority: v } });
}

function expectFold(events: IrEvent[]) {
  return fold(events.map((e) => JSON.parse(JSON.stringify(e))));
}

async function seed(ledger: IrLedger, events: IrEvent[]): Promise<void> {
  await ledger.init();
  for (const e of events) await ledger.appendEvent(e);
}

function checkpointFiles(fs: ReturnType<typeof memFs>): string[] {
  return [...fs.dump().keys()].filter((p) => p.includes("/checkpoint/"));
}

test("foldFrom continues the fold exactly: placements, undo, delete, due change", () => {
  const a = newElementId();
  const b = newElementId();
  const c = newElementId();
  const g = graded(a, 7, 5000);
  const events: IrEvent[] = [
    created(a, 1),
    created(b, 2),
    created(c, 3),
    ev({ lamport: 4, kind: "priority-set", target: b, payload: {
      priority: 20,
      placement: { requestedPriority: 20, beforeId: a },
    } }),
    ev({ lamport: 5, kind: "mercy-postponed", target: c, payload: { newDue: 9000, operation: "mercy" } }),
    ev({ lamport: 6, kind: "text-edited", target: c, payload: { text: "hello" } }),
    g,
    ev({ lamport: 8, kind: "grade-undone", target: a, payload: { eventId: g.id } }),
    ev({ lamport: 9, kind: "element-deleted", target: b }),
  ];

  // Cuts are chosen so a grade and its undo never straddle the boundary:
  // an undo of an already-folded event is the case that needs a rebuild, and
  // it is covered by its own test below.
  for (const cut of [1, 2, 3, 4, 5, 6, 9]) {
    const prefix = events.slice(0, cut).map((e) => JSON.parse(JSON.stringify(e)));
    const suffix = events.slice(cut).map((e) => JSON.parse(JSON.stringify(e)));
    const incremental = finalizeFold(foldFrom(foldIntermediate(prefix), suffix));
    assert.deepEqual(incremental, expectFold(events), `cut at ${cut}`);
  }
});

test("compactLocalShard writes a checkpoint covering the stream", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 13; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);

  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 5, maxAgeDays: 999_999 });

  assert.equal(checkpointFiles(fs).length, 1, "one checkpoint slot written");
  assert.deepEqual(await ledger.load(), expectFold(events));
});

test("the hot load path does not read compacted archives", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 40; i += 1) events.push(prio(id, i, i % 50));
  await seed(ledger, events);

  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 5, maxAgeDays: 999_999 });
  assert.ok(
    [...fs.dump().keys()].some((p) => p.startsWith(`${COMPACTIONDIR}/`)),
    "a transaction archive exists",
  );

  fs.reads.length = 0;
  await ledger.load();
  const archiveReads = fs.reads.filter((p) => p.startsWith(`${COMPACTIONDIR}/`));
  assert.deepEqual(archiveReads, [], "load() reads no archive once a checkpoint exists");
  assert.deepEqual(await ledger.load(), expectFold(events));
});

test("nextLamport is above every event, covered or live", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 20; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  const next = await ledger.nextLamport();
  assert.ok(next > Math.max(...events.map((e) => e.lamport)), `next ${next}`);
});

test("a late foreign event below the watermark forces a correct rebuild", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 15; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  // A device that was offline appends with a lamport the checkpoint has
  // already passed.
  const late = prio(id, 6, 99);
  const foreign = newDeviceId();
  await fs.write(
    `.ir/generations/${readGeneration(fs)}/log/${foreign}.jsonl`,
    JSON.stringify(late) + "\n",
  );

  const state = await ledger.load();
  assert.deepEqual(state, expectFold([...events, late]));
});

function readGeneration(fs: ReturnType<typeof memFs>): string {
  const meta = fs.dump().get(".ir/meta.json");
  assert.ok(meta, "meta exists");
  return String((JSON.parse(meta) as { generation?: string }).generation);
}

test("a re-synced covered event is skipped, not double-applied", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 12; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  const shardPath = [...fs.dump().keys()].find(
    (p) => p.includes("/log/") && p.endsWith(".jsonl") && !p.includes("dev_mig"),
  )!;
  const covered = events[0];
  await fs.append(shardPath, JSON.stringify(covered) + "\n");

  const before = checkpointFiles(fs).length;
  assert.deepEqual(await ledger.load(), expectFold(events));
  assert.equal(checkpointFiles(fs).length, before, "no rebuild was needed");
});

test("an undo of a folded grade rebuilds from the archive and stays exact", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const grade = graded(id, 2, 1111);
  const events: IrEvent[] = [created(id, 1), grade];
  for (let i = 3; i <= 12; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 2, maxAgeDays: 999_999 });

  const undo = ev({ lamport: 50, kind: "grade-undone", target: id, payload: { eventId: grade.id } });
  await ledger.appendEvent(undo);

  const state = await ledger.load();
  assert.equal(state.elements.get(id)?.card, undefined, "the grade was retracted");
  assert.deepEqual(state, expectFold([...events, undo]));
});

test("a torn checkpoint falls back and rewrites a valid one", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 12; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  const path = checkpointFiles(fs)[0]!;
  const body = fs.dump().get(path)!;
  fs.dump().set(path, body.slice(0, Math.floor(body.length / 2)));

  // A torn file is observed by a fresh ledger (the in-process cache still
  // holds the payload this instance wrote).
  const restarted = new IrLedger(fs);
  await restarted.init();
  assert.deepEqual(await restarted.load(), expectFold(events));
  const after = checkpointFiles(fs);
  assert.equal(after.length, 2, "the torn slot plus the rewritten one");
  const newest = after
    .map((p) => ({ p, seq: Number(p.slice(p.lastIndexOf("-") + 1, -".json".length)) }))
    .sort((x, y) => y.seq - x.seq)[0]!;
  assert.doesNotThrow(() => JSON.parse(fs.dump().get(newest.p)!), "the newest slot parses");
});

test("a later compaction extends the checkpoint and preserves state", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 10; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  for (let i = 11; i <= 20; i += 1) events.push(prio(id, i, i));
  for (const e of events.slice(10)) await ledger.appendEvent(e);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  assert.deepEqual(await ledger.load(), expectFold(events));
  assert.equal(checkpointFiles(fs).length, 2, "the current and previous slots remain");
});

test("compaction keeps the latest undoable grade in the active shard", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const grade = graded(id, 2, 1111);
  const events: IrEvent[] = [created(id, 1), grade];
  for (let i = 3; i <= 30; i += 1) {
    events.push(ev({ lamport: i, ts: (i - 20) * DAY, kind: "priority-set", target: id, payload: { priority: i } }));
  }
  await seed(ledger, events);

  await ledger.compactLocalShard(40 * DAY, { maxEvents: 3, maxAgeDays: 7 });

  const shardPath = [...fs.dump().keys()].find(
    (p) => p.includes("/log/") && p.endsWith(".jsonl") && !p.includes("dev_mig"),
  )!;
  const kept = fs.dump().get(shardPath)!.split("\n").filter(Boolean).map((l) => JSON.parse(l) as IrEvent);
  assert.ok(kept.some((e) => e.id === grade.id), "the undo target stays undoable");
  assert.deepEqual(await ledger.load(), expectFold(events));
});

test("a migration-log-shaped vault gets a checkpoint and stops reading the log", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id = newElementId();
  // Ten thousand migrated collections look like this: the history is in the
  // migration log, and the device shard holds almost nothing.
  const migrated: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 300; i += 1) migrated.push(prio(id, i, i % 50));
  const migrationPath = ".ir/log/dev_mig_ir_store.jsonl";
  await fs.write(migrationPath, migrated.map((e) => JSON.stringify(e) + "\n").join(""));

  const live = prio(id, 301, 7);
  await ledger.appendEvent(live);

  const built = await ledger.ensureCheckpoint(9_999_999_999);
  assert.deepEqual(built, { built: true, events: 301 }, "bootstrap covers the migration log");

  // A fresh instance must consume the checkpoint from disk and must not read
  // the migration log again.
  const restarted = new IrLedger(fs);
  await restarted.init();
  fs.reads.length = 0;
  assert.deepEqual(await restarted.load(), expectFold([...migrated, live]));
  assert.ok(
    fs.reads.some((p) => p.includes("/checkpoint/")),
    "the checkpoint is read",
  );
  assert.equal(
    fs.reads.filter((p) => p === migrationPath).length,
    0,
    "the migration log is not read once covered",
  );

  const extra = prio(id, 302, 9);
  await restarted.appendEvent(extra);
  assert.deepEqual(await restarted.load(), expectFold([...migrated, live, extra]));
});

test("a small history writes no checkpoint", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id = newElementId();
  const small: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 200; i += 1) small.push(prio(id, i, i % 50));
  await fs.write(
    ".ir/log/dev_mig_ir_store.jsonl",
    small.map((e) => JSON.stringify(e) + "\n").join(""),
  );

  const before = new Map(fs.dump());
  const built = await ledger.ensureCheckpoint(9_999_999_999);
  assert.deepEqual(built, { built: false, events: 200 });
  assert.deepEqual(fs.dump(), before, "no file touched below the threshold");
});

test("ensureCheckpoint is idempotent", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 20; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  const files = checkpointFiles(fs);
  const bodies = files.map((p) => fs.dump().get(p));
  const second = await ledger.ensureCheckpoint(9_999_999_999);
  assert.deepEqual(second, { built: false, events: 0 });
  assert.deepEqual(checkpointFiles(fs), files, "no new slot");
  assert.deepEqual(files.map((p) => fs.dump().get(p)), bodies, "no rewrite");
});

test("a torn newest slot rebuilds rather than trusting the older slot", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 10; i += 1) events.push(prio(id, i, i));
  await seed(ledger, events);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  for (let i = 11; i <= 20; i += 1) events.push(prio(id, i, i));
  for (const e of events.slice(10)) await ledger.appendEvent(e);
  await ledger.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  // Corrupt the newest slot. The older slot is still valid, but the shard was
  // pruned against the newest one, so using the older would lose events.
  const newest = checkpointFiles(fs)
    .map((p) => ({ p, seq: Number(p.slice(p.lastIndexOf("-") + 1, -".json".length)) }))
    .sort((a, b) => b.seq - a.seq)[0]!;
  fs.dump().set(newest.p, "{");

  const restarted = new IrLedger(fs);
  await restarted.init();
  assert.deepEqual(await restarted.load(), expectFold(events));
});
