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

test("per-host init: distinct hostnames get distinct ids on the same vault", async () => {
  // DESIGN §Q2 fix: when each device passes its hostname, two devices
  // sharing one synced vault end up with separate device ids and separate
  // log shards. Without this, they'd both inherit the id baked into
  // `.ir/device.json` and write to the same shard, causing Obsidian Sync
  // last-write-wins conflicts on the shard file.
  const fs = memFs();
  const a = new IrStore(fs);
  await a.init({ hostname: "alpha" });
  const idA = await a.getDeviceId();

  const b = new IrStore(fs);
  await b.init({ hostname: "beta" });
  const idB = await b.getDeviceId();

  assert.notEqual(idA, idB, "different hosts must get different ids");
});

test("per-host init: same hostname returns the same id on re-init", async () => {
  const fs = memFs();
  const a = new IrStore(fs);
  await a.init({ hostname: "alpha" });
  const idA = await a.getDeviceId();

  const b = new IrStore(fs);
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

  const original = new IrStore(fs);
  await original.init({ hostname: "alpha" });
  assert.equal(await original.getDeviceId(), "dev_legacy_id");

  // File now uses the new schema with alpha claiming the legacy id.
  const after = JSON.parse(await fs.read(".ir/device.json")) as {
    devices: Record<string, string>;
  };
  assert.deepEqual(after.devices, { alpha: "dev_legacy_id" });

  // A different host on the same vault gets a fresh id, not the legacy one.
  const other = new IrStore(fs);
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
  const a1 = new IrStore(fs);
  await a1.init({ hostname: "alpha" });
  const idA = await a1.getDeviceId();

  // Simulate a sync where device B's write clobbered the file.
  await fs.write(
    ".ir/device.json",
    JSON.stringify({ devices: { beta: "dev_beta_only" } }),
  );

  const a2 = new IrStore(fs);
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

test("loadBookmarks returns empty map when file is missing", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const bm = await store.loadBookmarks();
  assert.deepEqual(bm, {});
});

test("saveBookmarks + loadBookmarks round-trips", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const id = newElementId();
  const bm = {
    [id]: { elementId: id, line: 42, ch: 7, scrollTop: 300, updatedAt: 1000 },
  };
  await store.saveBookmarks(bm);
  const loaded = await store.loadBookmarks();
  assert.deepEqual(loaded, bm);
});

test("saveBookmarks overwrites previous bookmarks", async () => {
  const fs = memFs();
  const store = new IrStore(fs);
  await store.init();
  const id1 = newElementId();
  const id2 = newElementId();
  await store.saveBookmarks({
    [id1]: { elementId: id1, line: 1, ch: 0, scrollTop: 0, updatedAt: 1000 },
  });
  await store.saveBookmarks({
    [id2]: { elementId: id2, line: 99, ch: 3, scrollTop: 500, updatedAt: 2000 },
  });
  const loaded = await store.loadBookmarks();
  assert.equal(Object.keys(loaded).length, 1);
  assert.equal(loaded[id2]?.line, 99);
  assert.equal(loaded[id1], undefined);
});
