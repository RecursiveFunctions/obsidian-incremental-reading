/**
 * Golden contract for src/ir/ledger.ts (Q2 D, ledger IO half).
 *
 * Claude-authored, fenced out of the delegated scope. The oracle is an
 * in-memory VaultFs defined here: deterministic, no real filesystem. opencode
 * implements src/ir/ledger.ts from TASK.md and is judged by this suite + tsc.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { IrLedger, META, type VaultFs } from "../src/ir/ledger";
import type { IrEvent } from "../src/ir/model";
import { newElement } from "../src/ir/model";
import { newElementId, newEventId, newDeviceId, type ElementId } from "../src/ir/ids";
import type { SessionSnapshot } from "../src/ir/session-snapshot";

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
  const ledger = new IrLedger(fs);
  await ledger.init();
  assert.equal(await ledger.schemaVersion(), 1);
  const dev = await ledger.getDeviceId();
  assert.match(dev, /^dev_/);
});

test("commitMigration writes and verifies events before its completion marker", async () => {
  const fs = memFs();
  const operations: string[] = [];
  const write = fs.write.bind(fs);
  const read = fs.read.bind(fs);
  fs.write = async (path, data) => {
    operations.push(`write:${path}`);
    await write(path, data);
  };
  fs.read = async (path) => {
    operations.push(`read:${path}`);
    return read(path);
  };
  const ledger = new IrLedger(fs);
  await ledger.initDevice();
  const event = createEvent(newElementId(), 1);

  await ledger.commitMigration([event]);

  assert.equal(await ledger.status(), "migrated");
  const migrationWrite = operations.findIndex((op) => op.startsWith("write:") && op.endsWith("/dev_mig_ir_store.jsonl"));
  const migrationRead = operations.findIndex((op) => op.startsWith("read:") && op.endsWith("/dev_mig_ir_store.jsonl"));
  assert.ok(migrationWrite >= 0 && migrationWrite < migrationRead);
  assert.ok(migrationRead < operations.indexOf(`write:${META}`));
});

test("ready barrier keeps a concurrent live append in the committed generation", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.initDevice();
  const device = await ledger.getDeviceId();
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  ledger.setReadyBarrier(() => ready);
  const migrated = createEvent(newElementId(), 1);
  const live = createEvent(newElementId(), 2);
  const bookmarkId = newElementId();
  const bookmarks = {
    [bookmarkId]: {
      elementId: bookmarkId,
      line: 4,
      ch: 2,
      scrollTop: 100,
      updatedAt: 2000,
    },
  };

  const append = ledger.appendEvent(live);
  const saveBookmarks = ledger.saveBookmarks(bookmarks);
  await ledger.commitMigration([migrated]);
  assert.equal(fs.dump().has(`.ir/log/${device}.jsonl`), false);
  assert.equal(fs.dump().has(".ir/bookmarks.json"), false);
  release();
  await Promise.all([append, saveBookmarks]);

  assert.deepEqual(
    (await ledger.loadEvents()).map((event) => event.id).sort(),
    [migrated.id, live.id].sort(),
  );
  assert.deepEqual(await ledger.loadBookmarks(), bookmarks);
});

test("failed migration body write leaves migration uncommitted and retryable", async () => {
  const fs = memFs();
  const write = fs.write.bind(fs);
  let fail = true;
  fs.write = async (path, data) => {
    if (path.endsWith("/dev_mig_ir_store.jsonl") && fail) {
      fail = false;
      throw new Error("injected write failure");
    }
    await write(path, data);
  };
  const ledger = new IrLedger(fs);
  await ledger.initDevice();
  const event = createEvent(newElementId(), 1);

  await assert.rejects(ledger.commitMigration([event]), /injected write failure/);
  assert.equal(await ledger.status(), "absent");

  await ledger.commitMigration([event]);
  assert.equal(await ledger.status(), "migrated");
  assert.equal((await ledger.loadEvents()).length, 1);
});

test("reset marker remains inert across ledger instances", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.initDevice();
  await fs.write(".ir/log/stale.jsonl", JSON.stringify(createEvent(newElementId(), 1)) + "\n");
  await ledger.markReset();
  assert.equal(await ledger.status(), "reset");
  assert.equal(await new IrLedger(fs).status(), "reset");
  assert.deepEqual(await new IrLedger(fs).loadEvents(), []);
});

test("a migrated generation ignores stale pre-reset root shards", async () => {
  const fs = memFs();
  const stale = createEvent(newElementId(), 1);
  const current = createEvent(newElementId(), 2);
  await fs.write(".ir/log/stale.jsonl", JSON.stringify(stale) + "\n");
  const ledger = new IrLedger(fs);
  await ledger.initDevice();
  await ledger.commitMigration([current]);

  assert.deepEqual((await ledger.loadEvents()).map((event) => event.id), [current.id]);
});

test("migration verification rejects same-count event substitution", async () => {
  const fs = memFs();
  const read = fs.read.bind(fs);
  const replacement = createEvent(newElementId(), 2);
  fs.read = async (path) => path.endsWith("/dev_mig_ir_store.jsonl")
    ? JSON.stringify(replacement) + "\n"
    : read(path);
  const ledger = new IrLedger(fs);
  await ledger.initDevice();

  await assert.rejects(
    ledger.commitMigration([createEvent(newElementId(), 1)]),
    /persisted event mismatch/,
  );
  assert.equal(await ledger.status(), "absent");
});

test("legacy schema v1 metadata remains a committed legacy store", async () => {
  const fs = memFs();
  await fs.write(META, JSON.stringify({ schemaVersion: 1 }));
  assert.equal(await new IrLedger(fs).status(), "legacy");
});

test("unsupported ledger schemas fail closed", async () => {
  const fs = memFs();
  await fs.write(META, JSON.stringify({ schemaVersion: 2 }));
  await assert.rejects(new IrLedger(fs).status(), /unsupported schema version 2/);
});

test("device id is stable across init calls and ledger instances", async () => {
  const fs = memFs();
  const a = new IrLedger(fs);
  await a.init();
  const d1 = await a.getDeviceId();
  await a.init(); // second init must not regenerate
  assert.equal(await a.getDeviceId(), d1);

  const b = new IrLedger(fs); // different instance, same fs
  await b.init();
  assert.equal(await b.getDeviceId(), d1);
});

test("per-host init: distinct hostnames get distinct ids on the same vault", async () => {
  // DESIGN §Q2 fix: when each device passes its hostname, two devices
  // sharing one synced vault end up with separate device ids and separate
  // log shards. Without this, they'd both inherit the id baked into
  // `.ir/device.json` and write to the same shard, causing Obsidian Sync
  // last-write-wins conflicts on the shard file.
  const fs = memFs();
  const a = new IrLedger(fs);
  await a.init({ hostname: "alpha" });
  const idA = await a.getDeviceId();

  const b = new IrLedger(fs);
  await b.init({ hostname: "beta" });
  const idB = await b.getDeviceId();

  assert.notEqual(idA, idB, "different hosts must get different ids");
});

test("per-host init: same hostname returns the same id on re-init", async () => {
  const fs = memFs();
  const a = new IrLedger(fs);
  await a.init({ hostname: "alpha" });
  const idA = await a.getDeviceId();

  const b = new IrLedger(fs);
  await b.init({ hostname: "alpha" });
  assert.equal(await b.getDeviceId(), idA);
});

test("per-host init: upgrades legacy single-id schema to the host that runs first", async () => {
  // Existing users have `{deviceId: "..."}` on disk from before the fix.
  // The first device to load with the new code claims the legacy id for
  // its hostname — correct for the >99% case where that device is the one
  // that originally wrote the file. A second device loading later sees the
  // new schema, misses its hostname, and generates a fresh id.
  const fs = memFs();
  await fs.write(".ir/device.json", JSON.stringify({ deviceId: "dev_legacy_id" }));

  const original = new IrLedger(fs);
  await original.init({ hostname: "alpha" });
  assert.equal(await original.getDeviceId(), "dev_legacy_id");

  // File now uses the new schema with alpha claiming the legacy id.
  const after = JSON.parse(await fs.read(".ir/device.json")) as {
    devices: Record<string, string>;
  };
  assert.deepEqual(after.devices, { alpha: "dev_legacy_id" });

  // A different host on the same vault gets a fresh id, not the legacy one.
  const other = new IrLedger(fs);
  await other.init({ hostname: "beta" });
  const idBeta = await other.getDeviceId();
  assert.notEqual(idBeta, "dev_legacy_id");
  assert.match(idBeta, /^dev_/);
});

test("per-host init: clobbered entry is re-added on next load (sync-war recovery)", async () => {
  // Simulates the Obsidian Sync race: device A registers itself, device B
  // arrives and overwrites device.json with only its own entry, then device
  // A loads again and must restore its entry without changing its id.
  const fs = memFs();
  const a1 = new IrLedger(fs);
  await a1.init({ hostname: "alpha" });
  const idA = await a1.getDeviceId();

  // Simulate a sync where device B's write clobbered the file.
  await fs.write(
    ".ir/device.json",
    JSON.stringify({ devices: { beta: "dev_beta_only" } }),
  );

  const a2 = new IrLedger(fs);
  await a2.init({ hostname: "alpha" });
  // The id we generate for alpha is a NEW one (the previous id is lost
  // with the clobbered entry), but it's deterministic for the session and
  // both hosts are now present in the file.
  const idA2 = await a2.getDeviceId();
  assert.notEqual(idA2, "dev_beta_only");
  const merged = JSON.parse(await fs.read(".ir/device.json")) as {
    devices: Record<string, string>;
  };
  assert.equal(merged.devices.beta, "dev_beta_only");
  assert.equal(merged.devices.alpha, idA2);
  // Best-effort acknowledgement: idA1 may or may not equal idA2 depending
  // on whether the sync clobber preserved alpha's old entry. The fix's
  // guarantee is "alpha keeps writing to its own shard," not "alpha never
  // changes id."
  void idA;
});

test("appendEvent appends lines to this device's shard, never overwrites", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const dev = await ledger.getDeviceId();

  const id = newElementId();
  await ledger.appendEvent(createEvent(id, 1));
  await ledger.appendEvent(gradeEvent(id, 2, 5000, dev));

  const shardPath = `.ir/log/${dev}.jsonl`;
  const raw = await fs.read(shardPath);
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  assert.equal(lines.length, 2);
  for (const l of lines) JSON.parse(l); // each line is valid JSON
});

test("appendEvents is ordered and idempotent for identical event IDs", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const first = createEvent(newElementId(), 1);
  const second = createEvent(newElementId(), 2);
  const result = await ledger.appendEvents([first, second]);
  assert.deepEqual(result.landedIds, [first.id, second.id]);
  assert.deepEqual(result.alreadyPresentIds, []);

  const retry = await ledger.appendEvents([first, second]);
  assert.deepEqual(retry.landedIds, []);
  assert.deepEqual(retry.alreadyPresentIds, [first.id, second.id]);
  assert.deepEqual((await ledger.loadEvents()).map((event) => event.id), [first.id, second.id]);
});

test("appendEvents validates all events and rejects conflicting retries", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const event = createEvent(newElementId(), 1);
  await ledger.appendEvents([event]);
  await assert.rejects(ledger.appendEvents([{ ...event, lamport: 2 }]), /conflicting duplicate event id/);

  const valid = createEvent(newElementId(), 3);
  const invalid = { ...createEvent(newElementId(), 4), lamport: -1 };
  await assert.rejects(ledger.appendEvents([valid, invalid]), /lamport/);
  assert.equal((await ledger.loadEvents()).some((candidate) => candidate.id === valid.id), false);
});

test("load with no shards returns an empty state", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const s = await ledger.load();
  assert.equal(s.elements.size, 0);
  assert.equal(s.tombstones.size, 0);
});

test("load folds events across all device shards", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id = newElementId();

  await ledger.appendEvent(createEvent(id, 1));
  await ledger.appendEvent(gradeEvent(id, 2, 7000, await ledger.getDeviceId()));

  // A shard that arrived from another device via Sync.
  const otherDev = newDeviceId();
  const foreign = gradeEvent(id, 3, 4000, otherDev);
  await fs.write(`.ir/log/${otherDev}.jsonl`, JSON.stringify(foreign) + "\n");

  const s = await ledger.load();
  const el = s.elements.get(id);
  assert.ok(el);
  // Default conflict is conservative: earlier due (4000) wins over 7000.
  assert.equal(el.card?.due, 4000);
});

test("conflict option threads into the fold on load", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs, { conflict: "clock-order" });
  await ledger.init();
  const id = newElementId();

  await ledger.appendEvent(createEvent(id, 1));
  await ledger.appendEvent(gradeEvent(id, 2, 4000, await ledger.getDeviceId()));

  const otherDev = newDeviceId();
  await fs.write(
    `.ir/log/${otherDev}.jsonl`,
    JSON.stringify(gradeEvent(id, 3, 9000, otherDev)) + "\n",
  );

  const s = await ledger.load();
  // clock-order: highest lamport (3 -> due 9000) wins.
  assert.equal(s.elements.get(id)?.card?.due, 9000);
});

test("malformed shard lines fail with their source path", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id = newElementId();
  await ledger.appendEvent(createEvent(id, 1));

  const otherDev = newDeviceId();
  await fs.write(
    `.ir/log/${otherDev}.jsonl`,
    "not json\n" + JSON.stringify(gradeEvent(id, 2, 1234, otherDev)) + "\n\n",
  );

  await assert.rejects(ledger.load(), new RegExp(`invalid JSONL.*${otherDev}`));
});

test("appendEvent rejects invalid runtime data before writing", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  await assert.rejects(
    ledger.appendEvent({ ...createEvent(newElementId(), 1), lamport: -1 }),
    /lamport must be a non-negative integer/,
  );
  assert.equal((await fs.list(".ir/log")).length, 0);
});

test("loadEvents rejects syntactically valid invalid events", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  await fs.write(".ir/log/corrupt.jsonl", JSON.stringify({ kind: "graded" }) + "\n");
  await assert.rejects(ledger.loadEvents(), /id must be a non-empty string/);
});

test("loadEvents rejects conflicting duplicate IDs across durable sources", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const event = createEvent(newElementId(), 1);
  const conflicting = { ...event, lamport: 2, ts: 2000 };
  await fs.write(".ir/compaction/durable-source.jsonl", JSON.stringify(event) + "\n");
  await fs.write(".ir/log/other-device.jsonl", JSON.stringify(conflicting) + "\n");

  await assert.rejects(
    ledger.loadEvents(),
    new RegExp(`conflicting duplicate event id ${event.id}`),
  );
});

test("appendEvent rejects malformed nested event data", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id = newElementId();
  const event = createEvent(id, 1);
  const element = event.payload.element as Record<string, unknown>;
  element.anchor = { sourcePath: "note.md", quote: {} };

  await assert.rejects(ledger.appendEvent(event), /element-created payload is invalid/);

  const repaired = {
    ...event,
    kind: "anchor-repaired" as const,
    payload: { anchor: { sourcePath: "note.md", quote: { exact: "x" } } },
  };
  await assert.rejects(ledger.appendEvent(repaired), /anchor is required/);
});

test("loadBookmarks returns empty map when file is missing", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const bm = await ledger.loadBookmarks();
  assert.deepEqual(bm, {});
});

test("saveBookmarks + loadBookmarks round-trips", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id = newElementId();
  const bm = {
    [id]: { elementId: id, line: 42, ch: 7, scrollTop: 300, updatedAt: 1000 },
  };
  await ledger.saveBookmarks(bm);
  const loaded = await ledger.loadBookmarks();
  assert.deepEqual(loaded, bm);
});

test("saveBookmarks overwrites previous bookmarks", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const id1 = newElementId();
  const id2 = newElementId();
  await ledger.saveBookmarks({
    [id1]: { elementId: id1, line: 1, ch: 0, scrollTop: 0, updatedAt: 1000 },
  });
  await ledger.saveBookmarks({
    [id2]: { elementId: id2, line: 99, ch: 3, scrollTop: 500, updatedAt: 2000 },
  });
  const loaded = await ledger.loadBookmarks();
  assert.equal(Object.keys(loaded).length, 1);
  assert.equal(loaded[id2]?.line, 99);
  assert.equal(loaded[id1], undefined);
});

test("session snapshot storage is secondary and corrupt data is ignored", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  const snapshot: SessionSnapshot = {
    schemaVersion: 1,
    mode: "due",
    orderedIds: [newElementId()],
    cursor: 0,
    seed: 1,
    policyVersion: 1,
    repetitionDayKey: "2026-10-08",
    createdAt: 1,
  };
  await ledger.saveSessionSnapshot(snapshot);
  assert.deepEqual(await ledger.loadSessionSnapshot(), snapshot);
  await fs.write(".ir/session.json", "{");
  assert.equal(await ledger.loadSessionSnapshot(), null);
  assert.deepEqual(await ledger.loadEvents(), []);
});

test("auto-postpone marker round-trips independently of ledger events", async () => {
  const fs = memFs();
  const ledger = new IrLedger(fs);
  await ledger.init();
  await ledger.saveAutoPostponeMarker({ dayKey: "2026-10-08", batchId: "batch" });
  assert.deepEqual(await ledger.loadAutoPostponeMarker(), {
    dayKey: "2026-10-08",
    batchId: "batch",
  });
  assert.deepEqual(await ledger.loadEvents(), []);
});
