import assert from "node:assert/strict";
import { test } from "node:test";
import { IrLedger, type VaultFs } from "../src/ir/ledger";
import { elementIdForPath, type FrontmatterNote } from "../src/ir/migrate";
import { buildRecordedNoteEvents } from "../src/ir/record-note";
import { newEventId, type ElementId } from "../src/ir/ids";
import { IR_KEYS } from "../src/types";

const NOW = 1_700_000_000_000;

function memFs(): VaultFs {
  const files = new Map<string, string>();
  return {
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

function makeItemNote(path: string, parentPath?: string): FrontmatterNote {
  return {
    path,
    frontmatter: {
      [IR_KEYS.type]: "item",
      [IR_KEYS.priority]: 35,
      ...(parentPath ? { [IR_KEYS.parent]: parentPath } : {}),
      [IR_KEYS.due]: "2026-03-03T00:00:00.000Z",
      [IR_KEYS.stability]: 5,
      [IR_KEYS.difficulty]: 5,
      [IR_KEYS.reps]: 0,
      [IR_KEYS.lapses]: 0,
      [IR_KEYS.state]: 0,
    },
  };
}

test("buildRecordedNoteEvents mints fresh element & event ids when creating a child note at a renamed/reused path (#111)", async () => {
  const ledger = new IrLedger(memFs());
  await ledger.init();
  const device = await ledger.getDeviceId();

  // 1. Create initial child note at IR/Cloze 1.md
  const snap1 = await ledger.loadSnapshot();
  const res1 = buildRecordedNoteEvents(makeItemNote("IR/Cloze 1.md"), NOW, {
    liveElements: snap1.state.elements.values(),
    historicalEvents: snap1.events,
  });
  assert.equal(res1.events.length, 1);
  const firstId = res1.element!.id;
  assert.equal(firstId, elementIdForPath("IR/Cloze 1.md"));
  for (const ev of res1.events) {
    ev.device = device;
    ev.lamport = await ledger.nextLamport();
    await ledger.appendEvent(ev);
  }

  // 2. Rename IR/Cloze 1.md -> IR/Renamed Cloze.md
  await ledger.appendEvent({
    id: newEventId(),
    ts: NOW + 1000,
    lamport: await ledger.nextLamport(),
    device,
    kind: "source-renamed",
    target: firstId,
    payload: { oldPath: "IR/Cloze 1.md", newPath: "IR/Renamed Cloze.md" },
  });

  // 3. Create a brand-new child note reusing IR/Cloze 1.md
  const snap2 = await ledger.loadSnapshot();
  const res2 = buildRecordedNoteEvents(makeItemNote("IR/Cloze 1.md"), NOW + 2000, {
    liveElements: snap2.state.elements.values(),
    historicalEvents: snap2.events,
  });
  assert.equal(res2.events.length, 1);
  const secondId: ElementId = res2.element!.id;
  assert.notEqual(secondId, firstId, "reused path must receive a fresh ElementId");
  for (const ev of res2.events) {
    ev.device = device;
    ev.lamport = await ledger.nextLamport();
    await ledger.appendEvent(ev);
  }

  // 4. Both notes coexist cleanly in the folded ledger without collision or hijacking
  const finalState = await ledger.load();
  assert.equal(finalState.elements.size, 2);
  assert.equal(finalState.elements.get(firstId)?.notePath, "IR/Renamed Cloze.md");
  assert.equal(finalState.elements.get(secondId)?.notePath, "IR/Cloze 1.md");

  // 5. Re-recording an already-live note is a safe no-op returning the live element
  const snap3 = await ledger.loadSnapshot();
  const res3 = buildRecordedNoteEvents(makeItemNote("IR/Cloze 1.md"), NOW + 3000, {
    liveElements: snap3.state.elements.values(),
    historicalEvents: snap3.events,
  });
  assert.equal(res3.events.length, 0);
  assert.equal(res3.element?.id, secondId);
});

test("buildRecordedNoteEvents resolves ir-parent to a live element even when parent occupies a reused path (#111)", async () => {
  const ledger = new IrLedger(memFs());
  await ledger.init();
  const device = await ledger.getDeviceId();

  // Topic 1 created at Topics/A.md then renamed to Topics/A-old.md
  const r1 = buildRecordedNoteEvents(
    { path: "Topics/A.md", frontmatter: { [IR_KEYS.type]: "topic", [IR_KEYS.priority]: 20 } },
    NOW,
    { liveElements: [], historicalEvents: [] },
  );
  r1.events[0]!.device = device;
  r1.events[0]!.lamport = await ledger.nextLamport();
  await ledger.appendEvent(r1.events[0]!);
  await ledger.appendEvent({
    id: newEventId(),
    ts: NOW + 100,
    lamport: await ledger.nextLamport(),
    device,
    kind: "source-renamed",
    target: r1.element!.id,
    payload: { oldPath: "Topics/A.md", newPath: "Topics/A-old.md" },
  });

  // Topic 2 created at Topics/A.md (gets fresh id)
  const snap = await ledger.loadSnapshot();
  const r2 = buildRecordedNoteEvents(
    { path: "Topics/A.md", frontmatter: { [IR_KEYS.type]: "topic", [IR_KEYS.priority]: 30 } },
    NOW + 200,
    { liveElements: snap.state.elements.values(), historicalEvents: snap.events },
  );
  r2.events[0]!.device = device;
  r2.events[0]!.lamport = await ledger.nextLamport();
  await ledger.appendEvent(r2.events[0]!);

  // Child note pointing ir-parent at Topics/A.md resolves to Topic 2's fresh id, not Topic 1
  const snapAfter = await ledger.loadSnapshot();
  const child = buildRecordedNoteEvents(
    makeItemNote("IR/Child.md", "Topics/A.md"),
    NOW + 300,
    { liveElements: snapAfter.state.elements.values(), historicalEvents: snapAfter.events },
  );
  assert.equal(child.element?.parentId, r2.element!.id);
});
