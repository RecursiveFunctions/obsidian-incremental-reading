/**
 * Golden contract for IrStore shard compaction (Q2 D, sub-decision 3).
 *
 * Claude-authored, fenced out of the delegated scope. The oracle is an
 * in-memory VaultFs defined here: deterministic, no real filesystem. The
 * delegated agent implements compaction in src/ir/store.ts ONLY and is
 * judged solely by this suite + the rest of the suite staying green + tsc.
 * This file is the spec made executable; do not edit it to pass.
 *
 * Contract under test
 * -------------------
 * IrStore gains shard compaction wired to the log.ts `compact()` primitive:
 *
 *  - new exported path constants `SNAPSHOT` (".ir/snapshot.jsonl") and
 *    `RHISTDIR` (".ir/review-history").
 *  - `compactLocalShard(now, policy?)` operates on THIS device's shard only
 *    and returns `{ compacted, archived, dropped }`.
 *  - Trigger: no-op unless the local shard length exceeds `maxEvents`
 *    (default 250) OR its oldest event is older than `maxAgeDays`
 *    (default 7) relative to `now`. Defaults match log.ts `compact()`.
 *  - On compaction it delegates partitioning to log.ts `compact()`, then:
 *      * rewrites the local shard file to exactly the kept events,
 *      * appends the compacted-away events to the shared `SNAPSHOT` log,
 *      * appends the archived (review) events to this device's file under
 *        `RHISTDIR` (the optimizer/export feed; review events only),
 *      * never touches any other device's shard.
 *  - `load()` seeds from `SNAPSHOT` (when present) then folds every live
 *    shard, so folded state is identical before and after compaction.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IrStore,
  SNAPSHOT,
  RHISTDIR,
  LOGDIR,
  type VaultFs,
} from "../src/ir/store";
import {
  fold,
  type LogState,
} from "../src/ir/log";
import {
  isReviewEvent,
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

function created(id: ElementId, lamport: number, ts?: number): IrEvent {
  return ev({
    lamport,
    ts,
    kind: "element-created",
    target: id,
    payload: { element: newElement({ id, type: "item", priority: 50, now: 0 }) },
  });
}

function graded(id: ElementId, lamport: number, due: number, ts?: number): IrEvent {
  return ev({
    lamport,
    ts,
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

function prio(id: ElementId, lamport: number, v: number, ts?: number): IrEvent {
  return ev({ lamport, ts, kind: "priority-set", target: id, payload: { priority: v } });
}

/** Fold the events exactly as load() will see them (JSON round-tripped). */
function expectFold(events: IrEvent[]): LogState {
  return fold(events.map((e) => JSON.parse(JSON.stringify(e))));
}

function lines(s: string | undefined): IrEvent[] {
  if (!s) return [];
  return s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as IrEvent);
}

async function seed(store: IrStore, events: IrEvent[]): Promise<void> {
  await store.init();
  for (const e of events) await store.appendEvent(e);
}

test("compactLocalShard is a no-op below both thresholds", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  const id = newElementId();
  const events = [created(id, 1), prio(id, 2, 10), prio(id, 3, 20)];
  await seed(store, events);

  const before = new Map(fs.dump());
  const r = await store.compactLocalShard(5_000, { maxEvents: 250, maxAgeDays: 7 });

  assert.deepEqual(r, { compacted: false, archived: 0, dropped: 0 });
  assert.deepEqual(fs.dump(), before, "no file touched below thresholds");
  assert.equal(fs.dump().has(SNAPSHOT), false);
  assert.deepEqual(await store.load(), expectFold(events));
});

test("count trigger: local shard shrinks to the kept events, state preserved", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 13; i += 1) events.push(prio(id, i, i));
  await seed(store, events);

  const dev = await store.getDeviceId();
  const shardPath = `${LOGDIR}/${dev}.jsonl`;

  const r = await store.compactLocalShard(9_999_999_999, {
    maxEvents: 5,
    maxAgeDays: 999_999,
  });

  assert.equal(r.compacted, true);
  const kept = lines(fs.dump().get(shardPath));
  assert.equal(kept.length, 5, "local shard rewritten to exactly maxEvents");
  assert.deepEqual(
    kept.map((e) => e.lamport).sort((a, b) => a - b),
    [9, 10, 11, 12, 13],
    "the most recent events are the ones kept",
  );
  assert.equal(
    lines(fs.dump().get(SNAPSHOT)).length,
    8,
    "every compacted-away event lands in the snapshot",
  );
  // Folded state is invariant across compaction.
  assert.deepEqual(await store.load(), expectFold(events));
});

test("age safety net triggers even below the count cap", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  const id = newElementId();
  const now = 100 * DAY;
  const events = [
    created(id, 1, 1 * DAY),
    prio(id, 2, 7, 50 * DAY),
    prio(id, 3, 9, 99 * DAY),
  ];
  await seed(store, events);
  const dev = await store.getDeviceId();
  const shardPath = `${LOGDIR}/${dev}.jsonl`;

  const r = await store.compactLocalShard(now, {
    maxEvents: 999_999,
    maxAgeDays: 7,
  });

  assert.equal(r.compacted, true, "stale oldest event forces compaction");
  assert.deepEqual(
    lines(fs.dump().get(shardPath)).map((e) => e.lamport),
    [3],
    "only events within maxAgeDays stay in the active shard",
  );
  assert.deepEqual(await store.load(), expectFold(events));
});

test("only the local device shard is rewritten; foreign shards are byte-identical", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  const local = newElementId();
  const events: IrEvent[] = [created(local, 1)];
  for (let i = 2; i <= 10; i += 1) events.push(prio(local, i, i));
  await seed(store, events);

  // A second device's shard, written verbatim and never owned by this store.
  const foreignDev = newDeviceId();
  const foreignId = newElementId();
  const foreignEv = created(foreignId, 2);
  const foreignPath = `${LOGDIR}/${foreignDev}.jsonl`;
  const foreignRaw = JSON.stringify(foreignEv) + "\n";
  await fs.write(foreignPath, foreignRaw);

  await store.compactLocalShard(9_999_999_999, { maxEvents: 3, maxAgeDays: 999_999 });

  assert.equal(
    fs.dump().get(foreignPath),
    foreignRaw,
    "a device never compacts another device's shard",
  );
  // Cross-device state still resolves after a local compaction.
  assert.deepEqual(await store.load(), expectFold([...events, foreignEv]));
});

test("review-history guarantee: review events survive, history holds only reviews", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  const reviewIds = new Set<string>();
  for (let i = 2; i <= 40; i += 1) {
    if (i % 2 === 0) {
      const g = graded(id, i, i * 1000);
      reviewIds.add(g.id);
      events.push(g);
    } else {
      events.push(prio(id, i, i % 100));
    }
  }
  await seed(store, events);
  const dev = await store.getDeviceId();
  const shardPath = `${LOGDIR}/${dev}.jsonl`;
  const rhistPath = `${RHISTDIR}/${dev}.jsonl`;

  const r = await store.compactLocalShard(9_999_999_999, {
    maxEvents: 5,
    maxAgeDays: 999_999,
  });

  assert.equal(r.compacted, true);

  const survivors = new Set<string>(
    [...lines(fs.dump().get(shardPath)), ...lines(fs.dump().get(rhistPath))].map(
      (e) => e.id,
    ),
  );
  for (const rid of reviewIds) {
    assert.ok(survivors.has(rid), `review event ${rid} must survive compaction`);
  }

  const hist = lines(fs.dump().get(rhistPath));
  assert.ok(hist.length > 0, "archived reviews are written to review-history");
  for (const e of hist) {
    assert.ok(
      isReviewEvent(e.kind),
      "review-history is the optimizer feed: review events only",
    );
  }
  assert.equal(r.archived, hist.length);
  // Even with review events folded out, full state is preserved.
  assert.deepEqual(await store.load(), expectFold(events));
});

test("repeated compaction is idempotent for folded state", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  const id = newElementId();
  const events: IrEvent[] = [created(id, 1)];
  for (let i = 2; i <= 20; i += 1) {
    events.push(i % 3 === 0 ? graded(id, i, i * 1000) : prio(id, i, i));
  }
  await seed(store, events);

  await store.compactLocalShard(9_999_999_999, { maxEvents: 4, maxAgeDays: 999_999 });
  const afterFirst = await store.load();
  // A second pass (shard is now small) must not corrupt or double-count.
  const r2 = await store.compactLocalShard(9_999_999_999, {
    maxEvents: 4,
    maxAgeDays: 999_999,
  });
  assert.deepEqual(await store.load(), afterFirst);
  assert.deepEqual(await store.load(), expectFold(events));
  assert.equal(r2.compacted, false, "a shard already at/under the cap is left alone");
});
