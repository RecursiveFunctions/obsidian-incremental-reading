import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeRichCompon,
  delphiDateToEpochMs,
  planSmCollectionImport,
  type SmSourceFs,
} from "../src/ir/sm-collection-import";
import { contentFingerprint, normalizeUrlForDedupe } from "../src/ir/bulk-import";
import {
  foldSm20MatrixFromEvents,
  getSm20MatrixStats,
  matrixIndex,
  SM20_CASES_DAT_BYTES,
  SM20_SINC_DAT_BYTES,
} from "../src/ir/sm20-matrix";
import { fold } from "../src/ir/log";
import type { DeviceId, ElementId } from "../src/ir/ids";
import { validateIrEvent, type IrElement } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DEV = "dev_test" as DeviceId;
const DAY_MS = 86_400_000;
const DELPHI_EPOCH_MS = Date.UTC(1899, 11, 30);

function epochMsToDelphi(ms: number): number {
  return (ms - DELPHI_EPOCH_MS) / DAY_MS;
}

function makeMemRecord(position: number, length: number, slot = 0, listValue = 0): Uint8Array {
  const buf = new Uint8Array(30);
  const view = new DataView(buf.buffer);
  view.setUint32(0x0a, position, true);
  view.setUint32(0x0e, length, true);
  view.setUint32(0x12, listValue, true);
  view.setUint32(0x16, slot, true);
  return buf;
}

function makeRtxSpan(text: string, memberNumber: number, active = 1): Uint8Array {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.length + 6);
  out.set(body, 0);
  out[body.length] = 0;
  const view = new DataView(out.buffer);
  view.setUint32(body.length + 1, memberNumber, true);
  out[body.length + 5] = active;
  return out;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function makeElementInfo(opts: {
  type: number;
  status: number;
  textMember: number;
  reps?: number;
  lapses?: number;
  interval?: number;
  lastRepMs?: number;
  extractionMs?: number;
  sourceArticle?: number;
}): Uint8Array {
  const buf = new Uint8Array(118);
  const view = new DataView(buf.buffer);
  view.setUint8(0, opts.type);
  view.setUint8(1, opts.status);
  view.setInt32(2, opts.textMember, true);
  view.setUint16(12, opts.reps ?? 0, true);
  view.setUint16(14, opts.lapses ?? 0, true);
  view.setUint16(16, opts.interval ?? 0, true);
  if (opts.lastRepMs !== undefined) {
    view.setFloat64(20, epochMsToDelphi(opts.lastRepMs), true);
  }
  if (opts.extractionMs !== undefined) {
    view.setFloat64(77, epochMsToDelphi(opts.extractionMs), true);
  }
  view.setUint32(93, opts.sourceArticle ?? 0, true);
  return buf;
}

function makeContents(parentId: number, removed = 0): Uint8Array {
  const buf = new Uint8Array(37);
  const view = new DataView(buf.buffer);
  view.setUint8(0, removed);
  view.setUint32(1, parentId, true);
  return buf;
}

function makeComponRecord(opts: {
  elementNumber: number;
  readStart?: number;
  readLen?: number;
  scrollTop?: number;
  components: Array<{ type: number; displayAt: number; member: number }>;
  underReportBy?: number;
}): Uint8Array {
  const paramSize = 0x2b;
  const compSize = 3 + 0x1c;
  const actualBodyLen = 4 + 1 + 2 + paramSize + opts.components.length * compSize;
  const declaredBodyLen = Math.max(0, actualBodyLen - (opts.underReportBy ?? 0));
  const out = new Uint8Array(4 + actualBodyLen);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0xd431, true);
  view.setUint16(2, declaredBodyLen, true);
  view.setUint32(4, opts.elementNumber, true);
  view.setUint8(8, opts.components.length);
  view.setUint16(9, paramSize, true);
  const pBase = 11;
  if (opts.readStart !== undefined) view.setUint32(pBase + 0x18, opts.readStart, true);
  if (opts.readLen !== undefined) view.setUint16(pBase + 0x1c, opts.readLen, true);
  if (opts.scrollTop !== undefined) view.setUint32(pBase + 0x23, opts.scrollTop, true);
  let cursor = pBase + paramSize;
  for (const c of opts.components) {
    view.setUint8(cursor, c.type);
    view.setUint16(cursor + 1, 0x1c, true);
    const bufStart = cursor + 3;
    view.setUint8(bufStart + 0x08, c.displayAt);
    view.setUint32(bufStart + 0x11, c.member, true);
    cursor += compSize;
  }
  return out;
}

function makeSub(ids: number[]): Uint8Array {
  const out = new Uint8Array(ids.length * 4);
  const view = new DataView(out.buffer);
  ids.forEach((id, idx) => view.setUint32(idx * 4, id, true));
  return out;
}

function makeRepHistory(entries: Array<{ elementId: number; rep: number; lapses: number; iv: number; dateMs: number; grade: number }>): Uint8Array {
  const out = new Uint8Array(entries.length * 39);
  const view = new DataView(out.buffer);
  entries.forEach((e, i) => {
    const base = i * 39;
    view.setUint32(base + 0x00, e.elementId, true);
    view.setUint16(base + 0x04, e.rep, true);
    view.setUint16(base + 0x06, e.lapses, true);
    view.setUint16(base + 0x08, e.iv, true);
    view.setFloat64(base + 0x0a, epochMsToDelphi(e.dateMs), true);
    view.setInt8(base + 0x18, e.grade);
  });
  return out;
}

function memSourceFs(files: Record<string, Uint8Array>): SmSourceFs {
  return {
    async listDir(relDir: string): Promise<string[]> {
      const prefix = relDir ? `${relDir.replace(/\/+$/, "")}/` : "";
      return Object.keys(files).filter((k) => k.startsWith(prefix));
    },
    async readBinary(relPath: string): Promise<Uint8Array | null> {
      return files[relPath] ?? null;
    },
  };
}

test("decodeRichCompon resyncs with stride=1 past under-reported body_length and extracts bookmarks", () => {
  const rec1 = makeComponRecord({
    elementNumber: 1,
    readStart: 42,
    readLen: 10,
    scrollTop: 320,
    components: [{ type: 13, displayAt: 0xff, member: 1 }],
    underReportBy: 3,
  });
  const rec2 = makeComponRecord({
    elementNumber: 2,
    components: [
      { type: 1, displayAt: 0xff, member: 2 },
      { type: 1, displayAt: 0xd7, member: 3 },
    ],
  });
  const decoded = decodeRichCompon(concatBytes(rec1, rec2));
  assert.equal(decoded.size, 2);
  assert.deepEqual(decoded.get(1)?.bookmark, {
    readPointStart: 42,
    readPointLength: 10,
    readPointComponent: 0,
    readPointScrollTop: 320,
  });
  assert.equal(decoded.get(2)?.components.length, 2);
});

test("planSmCollectionImport maps topics, ledger-only extracts, Q&A clozes, attachments, bookmarks, and history", async () => {
  const s1 = makeRtxSpan("<h1>Root Topic</h1><p>Body paragraph</p>", 1);
  const s2 = makeRtxSpan("Extracted snippet", 2);
  const s3 = makeRtxSpan("What is 2+2? [...]", 3);
  const s4 = makeRtxSpan("4", 4);
  const deadReuse = makeRtxSpan("freed garbage\0", 99, 0);

  const textRtx = concatBytes(s1, deadReuse, s2, s3, s4);
  const pos1 = 1;
  const pos2 = 1 + s1.length + deadReuse.length;
  const pos3 = pos2 + s2.length;
  const pos4 = pos3 + s3.length;

  const textMem = concatBytes(
    makeMemRecord(pos1, s1.length),
    makeMemRecord(pos2, s2.length),
    makeMemRecord(pos3, s3.length),
    makeMemRecord(pos4, s4.length),
  );
  const textPtr = makeSub([1, 2, 3, 4]);

  const imgMem = makeMemRecord(1, 7, 10);
  const imgPtr = makeSub([1]);
  const imgRtx = makeRtxSpan("diagram", 1);

  const elementInfo = concatBytes(
    // 1: Root Topic (Memorized)
    makeElementInfo({ type: 0, status: 1, textMember: 1, reps: 2, interval: 10, lastRepMs: NOW - 3 * DAY_MS }),
    // 2: Text-only Extract (Pending -> staggered)
    makeElementInfo({ type: 0, status: 0, textMember: 2, sourceArticle: 1, extractionMs: NOW - 2 * DAY_MS }),
    // 3: Cloze Item with image attachment (Memorized)
    makeElementInfo({ type: 1, status: 1, textMember: 3, reps: 1, interval: 5, lastRepMs: NOW - DAY_MS }),
    // 4: Deleted element (skipped)
    makeElementInfo({ type: 0, status: 3, textMember: 1 }),
  );
  const contents = concatBytes(
    makeContents(0),
    makeContents(1),
    makeContents(2),
    makeContents(0, 1),
  );
  const compon = concatBytes(
    makeComponRecord({
      elementNumber: 1,
      readStart: 12,
      readLen: 5,
      scrollTop: 150,
      components: [{ type: 13, displayAt: 0xff, member: 1 }],
    }),
    makeComponRecord({
      elementNumber: 2,
      components: [{ type: 0, displayAt: 0xff, member: 2 }],
    }),
    makeComponRecord({
      elementNumber: 3,
      components: [
        { type: 1, displayAt: 0xff, member: 3 },
        { type: 1, displayAt: 0xd7, member: 4 },
        { type: 2, displayAt: 0xff, member: 1 },
      ],
    }),
  );

  const fs = memSourceFs({
    "info/ElementInfo.dat": elementInfo,
    "info/contents.dat": contents,
    "info/compon.dat": compon,
    "info/priority.sub": makeSub([1, 3, 2]),
    "info/RepetitionHistory.dat": makeRepHistory([
      { elementId: 3, rep: 1, lapses: 0, iv: 5, dateMs: NOW - DAY_MS, grade: 4 },
    ]),
    "registry/text.mem": textMem,
    "registry/text.ptr": textPtr,
    "registry/text.rtx": textRtx,
    "registry/image.mem": imgMem,
    "registry/image.ptr": imgPtr,
    "registry/image.rtx": imgRtx,
    "elements/10.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  });

  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });

  assert.equal(plan.stats.topics, 1);
  assert.equal(plan.stats.ledgerExtracts, 1);
  assert.equal(plan.stats.items, 1);
  assert.equal(plan.stats.skippedDeleted, 1);
  assert.equal(plan.stats.attachments, 1);
  assert.equal(plan.stats.bookmarks, 1);
  assert.equal(plan.stats.historyEvents, 1);

  // Only Topic + Item materialize as .md notes; text-only Extract stays ledger-only
  assert.equal(plan.notes.length, 2);
  const topicEl = plan.elements.find((e) => e.type === "topic")!;
  const extractEl = plan.elements.find((e) => e.type === "extract")!;
  const itemEl = plan.elements.find((e) => e.type === "item")!;

  assert.ok(topicEl.notePath?.startsWith("SM Import/"));
  assert.equal(extractEl.notePath, undefined);
  assert.equal(extractEl.parentId, topicEl.id);
  assert.equal(itemEl.parentId, extractEl.id);
  assert.ok(itemEl.text.includes("What is 2+2? {{c1::4}}"));
  assert.ok(itemEl.text.includes("![[SM Import/attachments/sm-3-1.png]]"));
  // Pending extract has staggered future due date
  assert.ok((extractEl.schedule?.due ?? 0) > NOW);
});

test("duplicate guard skips already-imported elements and normalizes URLs without network literals", async () => {
  const existing: IrElement = {
    id: "el_existing" as ElementId,
    type: "topic",
    priority: 30,
    parentId: null,
    dismissed: false,
    created: NOW - DAY_MS,
    text: "Duplicate body text",
    anchorState: "ok",
  };
  const span = makeRtxSpan("Duplicate body text", 1);
  const fs = memSourceFs({
    "info/ElementInfo.dat": makeElementInfo({ type: 0, status: 1, textMember: 1 }),
    "registry/text.mem": makeMemRecord(1, span.length),
    "registry/text.ptr": makeSub([1]),
    "registry/text.rtx": span,
  });
  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
    existingElements: new Map([[existing.id, existing]]),
  });
  assert.equal(plan.stats.skippedDuplicates, 1);
  assert.equal(plan.elements.length, 0);

  assert.equal(
    normalizeUrlForDedupe("HTTPS://www.Example.COM/path/#section"),
    "example.com/path",
  );
  assert.equal(
    contentFingerprint("  Hello   World "),
    contentFingerprint("hello world"),
  );
});

test("planSmCollectionImport keeps note-path suffix probing linear for colliding titles", async () => {
  const N = 200;
  const sharedStem = "S".repeat(72);
  const spans: Uint8Array[] = [];
  const memRecords: Uint8Array[] = [];
  let position = 1;
  for (let i = 0; i < N; i += 1) {
    const text = `${sharedStem} body ${i}`;
    const span = makeRtxSpan(text, i + 1);
    spans.push(span);
    memRecords.push(makeMemRecord(position, span.length));
    position += span.length;
  }
  const registryPtr = makeSub(Array.from({ length: N }, (_, i) => i + 1));
  const elementInfo = concatBytes(
    ...Array.from({ length: N }, (_, i) => makeElementInfo({ type: 0, status: 0, textMember: i + 1 })),
  );
  const contents = concatBytes(...Array.from({ length: N }, () => makeContents(0)));
  const fs = memSourceFs({
    "info/ElementInfo.dat": elementInfo,
    "info/contents.dat": contents,
    "registry/text.mem": concatBytes(...memRecords),
    "registry/text.ptr": registryPtr,
    "registry/text.rtx": concatBytes(...spans),
  });

  const originalHas = Set.prototype.has;
  let probes = 0;
  Set.prototype.has = function (key: unknown) {
    if (typeof key === "string" && key.endsWith(".md")) probes += 1;
    return originalHas.call(this, key);
  };
  let plan;
  try {
    plan = await planSmCollectionImport({
      fs,
      nowMs: NOW,
      deviceId: DEV,
      targetFolder: "SM Import",
    });
  } finally {
    Set.prototype.has = originalHas;
  }

  assert.equal(plan.notes.length, N);
  assert.equal(plan.notes[0]!.relPath, `SM Import/${sharedStem}.md`);
  assert.equal(plan.notes[1]!.relPath, `SM Import/${sharedStem} 2.md`);
  assert.ok(probes <= N + 2, `expected linear suffix probing, got ${probes}`);
});

test("import seeds sm20Baseline from alg17/*.dat and cursor skips imported RepetitionHistory.dat", async () => {
  const sincBuf = new Uint8Array(SM20_SINC_DAT_BYTES);
  const sincCasesBuf = new Uint8Array(SM20_CASES_DAT_BYTES);
  const recallBuf = new Uint8Array(SM20_CASES_DAT_BYTES);
  const recallCasesBuf = new Uint8Array(SM20_CASES_DAT_BYTES);
  const idx = matrixIndex(5, 3, 18);
  new DataView(sincBuf.buffer).setFloat64(idx * 8, 4.2, true);
  new DataView(sincCasesBuf.buffer).setUint32(idx * 4, 25, true);
  new DataView(recallBuf.buffer).setUint32(idx * 4, 24, true);
  new DataView(recallCasesBuf.buffer).setUint32(idx * 4, 25, true);

  const span = makeRtxSpan("Item Q", 1);
  const fs = memSourceFs({
    "info/ElementInfo.dat": makeElementInfo({ type: 1, status: 1, textMember: 1, reps: 1, interval: 5, lastRepMs: NOW - DAY_MS }),
    "info/RepetitionHistory.dat": makeRepHistory([
      { elementId: 1, rep: 1, lapses: 0, iv: 5, dateMs: NOW - DAY_MS, grade: 4 },
    ]),
    "registry/text.mem": makeMemRecord(1, span.length),
    "registry/text.ptr": makeSub([1]),
    "registry/text.rtx": span,
    "alg17/StabilityIncrease.dat": sincBuf,
    "alg17/StabilityIncreaseCases.dat": sincCasesBuf,
    "alg17/Recall.dat": recallBuf,
    "alg17/RecallCases.dat": recallCasesBuf,
  });

  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });
  assert.ok(plan.sm20Baseline);
  assert.ok(plan.baselineCursorEventId);

  // Folding imported events from baseline + cursor must NOT double-count RepetitionHistory.dat
  const seeded = foldSm20MatrixFromEvents(plan.events, {
    baseline: plan.sm20Baseline,
    afterEventId: plan.baselineCursorEventId,
  });
  const stats = getSm20MatrixStats(seeded);
  assert.equal(stats.totalSincCases, 25);
  assert.equal(stats.totalRecallCases, 25);
});

test("planSmCollectionImport scans nested TFileSpace elements/<bucket>/ dirs, ignores status grade=8 on topics, and preserves ElementInfo card state on fold", async () => {
  const htmlBytes = new TextEncoder().encode("<p>Nested slot 62 body</p>");
  const qSpan = makeRtxSpan("Question [...]", 1);
  const aSpan = makeRtxSpan("Answer", 2);
  const textRtx = concatBytes(qSpan, aSpan);
  const textMem = concatBytes(
    makeMemRecord(0, 0, 62), // Topic backed by nested elements/6/62.HTM
    makeMemRecord(1, qSpan.length),
    makeMemRecord(1 + qSpan.length, aSpan.length),
  );
  const textPtr = makeSub([1, 2, 3]);

  const elementInfo = concatBytes(
    // 1: Topic using slot 62 in nested elements/6/62.HTM
    makeElementInfo({ type: 0, status: 1, textMember: 1, reps: 1, interval: 14, lastRepMs: NOW - 2 * DAY_MS }),
    // 2: Item with current interval=30d in ElementInfo, but preceding iv=0 on rep 1 in RepetitionHistory.dat
    makeElementInfo({ type: 1, status: 1, textMember: 2, reps: 1, interval: 30, lastRepMs: NOW - 2 * DAY_MS }),
  );
  const compon = concatBytes(
    makeComponRecord({ elementNumber: 1, components: [{ type: 13, displayAt: 0xff, member: 1 }] }),
    makeComponRecord({
      elementNumber: 2,
      components: [
        { type: 1, displayAt: 0xff, member: 2 },
        { type: 1, displayAt: 0xd7, member: 3 },
      ],
    }),
  );

  // MemSourceFs mimicking directory-by-directory listing (like real fs.readdir / adapter.list)
  const rawFiles: Record<string, Uint8Array> = {
    "info/ElementInfo.dat": elementInfo,
    "info/compon.dat": compon,
    "info/RepetitionHistory.dat": makeRepHistory([
      // ABC of SuperMemo 20 style grade=8 status code on Topic 1 -> must NOT become graded item event
      { elementId: 1, rep: 1, lapses: 0, iv: 0, dateMs: NOW - 2 * DAY_MS, grade: 8 },
      // Item 2 rep 1 with preceding iv=0 -> must NOT clobber ElementInfo's 30d interval!
      { elementId: 2, rep: 1, lapses: 0, iv: 0, dateMs: NOW - 2 * DAY_MS, grade: 4 },
    ]),
    "registry/text.mem": textMem,
    "registry/text.ptr": textPtr,
    "registry/text.rtx": textRtx,
    "elements/6/62.HTM": htmlBytes,
  };
  const dirFs: SmSourceFs = {
    async listDir(relDir: string): Promise<string[]> {
      const clean = relDir.replace(/\/+$/, "");
      const prefix = clean ? `${clean}/` : "";
      const children = new Set<string>();
      for (const k of Object.keys(rawFiles)) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        const seg = rest.split("/")[0]!;
        children.add(clean ? `${clean}/${seg}` : seg);
      }
      return [...children];
    },
    async readBinary(relPath: string): Promise<Uint8Array | null> {
      return rawFiles[relPath] ?? null;
    },
  };

  const plan = await planSmCollectionImport({
    fs: dirFs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });

  const topicEl = plan.elements.find((e) => e.type === "topic")!;
  assert.ok(topicEl.text.includes("Nested slot 62 body"), `expected nested HTM body, got: ${topicEl.text}`);
  assert.equal(plan.stats.historyEvents, 1, "grade=8 topic status row must not emit graded event");

  const folded = fold(plan.events, { conflict: "clock-order" });
  const foldedTopic = folded.elements.get(topicEl.id)!;
  assert.equal(foldedTopic.card, undefined, "topic must not acquire a StoredCard from RepetitionHistory");

  const itemEl = plan.elements.find((e) => e.type === "item")!;
  const foldedItem = folded.elements.get(itemEl.id)!;
  assert.equal(foldedItem.card?.scheduledDays, 30, "ElementInfo scheduledDays must survive RepetitionHistory fold");
  assert.equal(foldedItem.card?.due, (NOW - 2 * DAY_MS) + 30 * DAY_MS);
});

test("delphiDateToEpochMs and planSmCollectionImport (#84) clamp overflowing Delphi TDateTime values to finite valid dates", async () => {
  assert.equal(delphiDateToEpochMs(2.1e300), null);
  assert.equal(delphiDateToEpochMs(1e305), null);
  assert.equal(delphiDateToEpochMs(Number.POSITIVE_INFINITY), null);
  assert.equal(delphiDateToEpochMs(Number.NaN), null);
  assert.equal(delphiDateToEpochMs(2e8), null); // > ±8.64e15 ms JS Date range

  const topicSpan = makeRtxSpan("Topic With Corrupt Date", 1);
  const itemSpan = makeRtxSpan("Item With Corrupt Date", 2);
  const rtx = concatBytes(topicSpan, itemSpan);
  const mem = concatBytes(
    makeMemRecord(1, topicSpan.length),
    makeMemRecord(1 + topicSpan.length, itemSpan.length),
  );

  const recTopic = makeElementInfo({ type: 0, status: 1, textMember: 1, reps: 2, interval: 10 });
  new DataView(recTopic.buffer).setFloat64(20, 2.1e300, true);
  new DataView(recTopic.buffer).setFloat64(77, 1e305, true);

  const recItem = makeElementInfo({ type: 1, status: 1, textMember: 2, reps: 3, interval: 7 });
  new DataView(recItem.buffer).setFloat64(20, 2.1e300, true);
  new DataView(recItem.buffer).setFloat64(77, 1e305, true);

  const repHist = makeRepHistory([
    { elementId: 2, rep: 1, lapses: 0, iv: 7, dateMs: NOW - DAY_MS, grade: 4 },
  ]);
  // Add a second RepetitionHistory row with an overflowing Delphi float
  const badHistRow = new Uint8Array(39);
  const badHistView = new DataView(badHistRow.buffer);
  badHistView.setUint32(0x00, 2, true);
  badHistView.setUint16(0x04, 2, true);
  badHistView.setFloat64(0x0a, 2.1e300, true);
  badHistView.setInt8(0x18, 4);

  const fs = memSourceFs({
    "info/ElementInfo.dat": concatBytes(recTopic, recItem),
    "info/RepetitionHistory.dat": concatBytes(repHist, badHistRow),
    "registry/text.mem": mem,
    "registry/text.ptr": makeSub([1, 2]),
    "registry/text.rtx": rtx,
  });

  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });

  assert.equal(plan.elements.length, 2);
  for (const el of plan.elements) {
    assert.ok(Number.isFinite(el.created));
    if (el.schedule) assert.ok(Number.isFinite(el.schedule.due));
    if (el.card) assert.ok(Number.isFinite(el.card.due));
  }
  for (const ev of plan.events) {
    assert.equal(validateIrEvent(ev), null);
  }
  for (const n of plan.notes) {
    assert.ok(Number.isFinite(n.frontmatter["ir-due"] as number));
  }
});

test("planSmCollectionImport (#82) resolves 500 colliding 72-char title prefixes in linear time with exact suffix order", async () => {
  const sharedPrefix = "A".repeat(72);
  const count = 500;
  const spans: Uint8Array[] = [];
  const mems: Uint8Array[] = [];
  const infos: Uint8Array[] = [];
  const componRecs: Uint8Array[] = [];
  const ptrIds: number[] = [];

  // Also append ["Cross", "Cross 2", "Cross"] to verify cross-stem suffix preservation
  const extraTitles = ["Cross", "Cross 2", "Cross"];
  const totalElements = count + extraTitles.length;
  let pos = 1;

  for (let i = 1; i <= totalElements; i += 1) {
    const title = i <= count ? `${sharedPrefix} extra-${i}` : extraTitles[i - count - 1]!;
    const body = `${title} — unique body payload #${i}`;
    const titleSpan = makeRtxSpan(title, i * 2 - 1);
    const bodySpan = makeRtxSpan(body, i * 2);
    spans.push(titleSpan, bodySpan);
    mems.push(makeMemRecord(pos, titleSpan.length));
    pos += titleSpan.length;
    mems.push(makeMemRecord(pos, bodySpan.length));
    pos += bodySpan.length;
    ptrIds.push(i * 2 - 1, i * 2);
    infos.push(makeElementInfo({ type: 0, status: 1, textMember: i * 2 - 1, reps: 1, interval: 5, lastRepMs: NOW - DAY_MS }));
    componRecs.push(makeComponRecord({ elementNumber: i, components: [{ type: 0, displayAt: 0xff, member: i * 2 }] }));
  }

  const fs = memSourceFs({
    "info/ElementInfo.dat": concatBytes(...infos),
    "info/compon.dat": concatBytes(...componRecs),
    "registry/text.mem": concatBytes(...mems),
    "registry/text.ptr": makeSub(ptrIds),
    "registry/text.rtx": concatBytes(...spans),
  });

  const t0 = performance.now();
  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });
  const elapsedMs = performance.now() - t0;

  assert.equal(plan.notes.length, totalElements);
  assert.equal(plan.notes[0]!.relPath, `SM Import/${sharedPrefix}.md`);
  assert.equal(plan.notes[1]!.relPath, `SM Import/${sharedPrefix} 2.md`);
  assert.equal(plan.notes[count - 1]!.relPath, `SM Import/${sharedPrefix} ${count}.md`);
  assert.equal(plan.notes[count]!.relPath, "SM Import/Cross.md");
  assert.equal(plan.notes[count + 1]!.relPath, "SM Import/Cross 2.md");
  assert.equal(plan.notes[count + 2]!.relPath, "SM Import/Cross 3.md");
  assert.ok(elapsedMs < 1_000, `expected fast linear planning, took ${elapsedMs.toFixed(1)}ms`);
});

test("planSmCollectionImport (#83) reads image.mem filespace_slot at 0x16, ignores .HTM non-images, resolves PrimaryStorage/relative HTML images, and keeps inline-image extracts ledger-only", async () => {
  const enc = new TextEncoder();
  const sTopic = makeRtxSpan("Plain stripped topic summary", 1);
  const sExtract = makeRtxSpan("Plain stripped extract summary", 2);
  const textRtx = concatBytes(sTopic, sExtract);
  // Topic member 1 has list_value=42 at 0x12 and real HTML slot=65 at 0x16.
  // Extract member 2 has HTML slot=42 at 0x16.
  const textMem = concatBytes(
    makeMemRecord(1, sTopic.length, 65, 42),
    makeMemRecord(1 + sTopic.length, sExtract.length, 42, 0),
  );

  // Image member 1 has list_value=65 (pointing to 65.HTM!) at 0x12, and real binary image slot=8 at 0x16.
  // Image member 2 has slot=65 (.HTM) at 0x16 -> must be rejected by binary image extension filter.
  const imgRtx = concatBytes(makeRtxSpan("icon", 1), makeRtxSpan("bogus-htm", 2));
  const imgMem = concatBytes(
    makeMemRecord(1, 10, 8, 65),
    makeMemRecord(11, 15, 65, 0),
  );

  const elementInfo = concatBytes(
    // 1: Topic with creation timestamp in extraction_date (42501.0) and source_article=0 -> MUST be "topic", not "extract"
    makeElementInfo({ type: 0, status: 1, textMember: 1, reps: 1, interval: 7, lastRepMs: NOW - DAY_MS, extractionMs: NOW - 10 * DAY_MS, sourceArticle: 0 }),
    // 2: Extract with source_article=1 and HTML backing file containing relative ../10\102.jpg + bogus .HTM componentType=2
    makeElementInfo({ type: 0, status: 0, textMember: 2, sourceArticle: 1, extractionMs: NOW - DAY_MS }),
  );
  const contents = concatBytes(makeContents(0), makeContents(1));
  const compon = concatBytes(
    makeComponRecord({
      elementNumber: 1,
      components: [
        { type: 13, displayAt: 0xff, member: 1 },
        { type: 2, displayAt: 0xff, member: 1 },
      ],
    }),
    makeComponRecord({
      elementNumber: 2,
      components: [
        { type: 13, displayAt: 0xff, member: 2 },
        { type: 2, displayAt: 0xff, member: 2 },
      ],
    }),
  );

  const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  const fs = memSourceFs({
    "info/ElementInfo.dat": elementInfo,
    "info/contents.dat": contents,
    "info/compon.dat": compon,
    "registry/text.mem": textMem,
    "registry/text.ptr": makeSub([1, 2]),
    "registry/text.rtx": textRtx,
    "registry/image.mem": imgMem,
    "registry/image.ptr": makeSub([1, 2]),
    "registry/image.rtx": imgRtx,
    "elements/6/65.HTM": enc.encode(
      '<p>Return with <img src="file:///[PrimaryStorage]3/39.gif"> and <img src="65_files/extra.jpg"></p>',
    ),
    "elements/6/65_files/extra.jpg": jpgBytes,
    "elements/4/42.HTM": enc.encode(
      '<p>Extract body with <IMG src="../10\\102.jpg"> inline.</p>',
    ),
    "elements/8.png": pngBytes,
    "elements/3/39.gif": gifBytes,
    "elements/10/102.jpg": jpgBytes,
  });

  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });

  // Zero .HTM attachments
  for (const att of plan.attachments) {
    assert.equal(/\.htm/i.test(att.targetFileName), false, `unexpected HTM attachment: ${att.targetFileName}`);
    assert.equal(/\.htm/i.test(att.sourceRelPath), false, `unexpected HTM source: ${att.sourceRelPath}`);
  }
  // Expected binary attachments: 39.gif, extra.jpg, 8.png, 102.jpg
  assert.equal(plan.attachments.length, 4);

  const topicEl = plan.elements.find((e) => e.type === "topic")!;
  const extractEl = plan.elements.find((e) => e.type === "extract")!;

  assert.ok(topicEl.text.includes("![[SM Import/attachments/sm-asset-39.gif]]"));
  assert.ok(topicEl.text.includes("![[SM Import/attachments/sm-asset-extra.jpg]]"));
  assert.ok(topicEl.text.includes("![[SM Import/attachments/sm-1-1.png]]"));

  // Inline HTML image on extract is preserved in element.text, while extract stays ledger-only by default!
  assert.ok(extractEl.text.includes("![[SM Import/attachments/sm-asset-102.jpg]]"));
  assert.equal(extractEl.notePath, undefined);
  assert.equal(plan.stats.ledgerExtracts, 1);
  assert.equal(plan.stats.noteExtracts, 0);

  // Opting in via extractCreatesStandaloneNote materializes the extract note too
  const standalonePlan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
    extractCreatesStandaloneNote: true,
  });
  assert.equal(standalonePlan.stats.noteExtracts, 1);
  assert.equal(standalonePlan.stats.ledgerExtracts, 0);
});

test("planSmCollectionImport rejects source-tree traversal entries in elements/ and preserves <angle> tokens in plain fallback text", async () => {
  const enc = new TextEncoder();
  const s1 = makeRtxSpan("Vector<int> & Map<string, number>", 1);
  const textMem = makeMemRecord(1, s1.length, 1, 0);
  const imgRtx = makeRtxSpan("secret", 1);
  const imgMem = makeMemRecord(1, imgRtx.length, 9, 0);

  const elementInfo = makeElementInfo({
    type: 0,
    status: 1,
    textMember: 1,
    reps: 1,
    interval: 5,
    lastRepMs: NOW - DAY_MS,
  });
  const compon = makeComponRecord({
    elementNumber: 1,
    components: [{ type: 2, displayAt: 0xff, member: 1 }],
  });

  const readPaths: string[] = [];
  const fs: SmSourceFs = {
    async listDir(rel) {
      if (rel === "info") return ["ElementInfo.dat", "compon.dat"];
      if (rel === "registry") return ["text.mem", "text.ptr", "text.rtx", "image.mem", "image.ptr", "image.rtx"];
      if (rel === "elements") return ["..\\..\\secret\\9.png", "../outside/9.png", "1.txt"];
      return [];
    },
    async readBinary(rel) {
      readPaths.push(rel);
      const map: Record<string, Uint8Array> = {
        "info/ElementInfo.dat": elementInfo,
        "info/compon.dat": compon,
        "registry/text.mem": textMem,
        "registry/text.ptr": makeSub([1]),
        "registry/text.rtx": s1,
        "registry/image.mem": imgMem,
        "registry/image.ptr": makeSub([1]),
        "registry/image.rtx": imgRtx,
        "elements/1.txt": enc.encode("Plain note with <T> generic parameter"),
      };
      return map[rel] ?? null;
    },
  };

  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });

  assert.equal(plan.attachments.length, 0);
  assert.equal(readPaths.some((p) => p.includes("..") || p.includes("secret") || p.includes("outside")), false);
  assert.equal(plan.elements[0]!.text, "Plain note with <T> generic parameter");
});

test("planSmCollectionImport: existing vault paths force a distinct note path", async () => {
  const build = (payload: string) => {
    const title = makeRtxSpan("Shared Title", 1);
    const body = makeRtxSpan(payload, 2);
    const fs = memSourceFs({
      "info/ElementInfo.dat": makeElementInfo({ type: 0, status: 1, textMember: 1 }),
      "info/compon.dat": makeComponRecord({ elementNumber: 1, components: [{ type: 0, displayAt: 0xff, member: 2 }] }),
      "registry/text.mem": concatBytes(
        makeMemRecord(1, title.length),
        makeMemRecord(1 + title.length, body.length),
      ),
      "registry/text.ptr": makeSub([1, 2]),
      "registry/text.rtx": concatBytes(title, body),
    });
    return fs;
  };
  const first = await planSmCollectionImport({
    fs: build("ALPHA"), nowMs: NOW, deviceId: DEV, targetFolder: "SM Import",
  });
  assert.equal(first.notes[0]!.relPath, "SM Import/Shared Title.md");

  const second = await planSmCollectionImport({
    fs: build("BETA"), nowMs: NOW, deviceId: DEV, targetFolder: "SM Import",
    existingPaths: new Set(first.notes.map((n) => n.relPath)),
  });
  assert.equal(second.notes[0]!.relPath, "SM Import/Shared Title 2.md");
  assert.equal(second.notes[0]!.markdown.includes("BETA"), true);
});

test("planSmCollectionImport repairs missing early history dates, non-positive intervals, and stale ElementInfo dates (#73)", async () => {
  const q = makeRtxSpan("What is SM-20? [...]", 1);
  const a = makeRtxSpan("Spaced repetition", 2);
  const elInfoBuf = makeElementInfo({
    type: 1,
    status: 1,
    textMember: 1,
    reps: 3,
    lapses: 0,
    interval: 10,
    // Stale ElementInfo lastRepMs (10 days older than latest RepetitionHistory row)
    lastRepMs: NOW - 15 * DAY_MS,
  });
  // Set last_repetition_day (offset 18, uint16) > 0x7ffe (0x7fff)
  new DataView(elInfoBuf.buffer).setUint16(18, 0x7fff, true);

  // Build RepetitionHistory with first two rows missing timestamps (date = 0 <= 1.0)
  // and row 1 carrying non-positive interval 0.
  const latestRepMs = NOW - 5 * DAY_MS;
  const repBuf = new Uint8Array(3 * 39);
  const rv = new DataView(repBuf.buffer);
  // Row 0: rep 1, iv 0, date 0 (missing!)
  rv.setUint32(0, 1, true);
  rv.setUint16(4, 1, true);
  rv.setUint16(6, 0, true);
  rv.setUint16(8, 0, true);
  rv.setFloat64(10, 0, true);
  rv.setInt8(24, 4);
  // Row 1: rep 2, iv 4, date 0 (missing!)
  rv.setUint32(39 + 0, 1, true);
  rv.setUint16(39 + 4, 2, true);
  rv.setUint16(39 + 6, 0, true);
  rv.setUint16(39 + 8, 4, true);
  rv.setFloat64(39 + 10, 0, true);
  rv.setInt8(39 + 24, 4);
  // Row 2: rep 3, iv 10, date = latestRepMs
  rv.setUint32(78 + 0, 1, true);
  rv.setUint16(78 + 4, 3, true);
  rv.setUint16(78 + 6, 0, true);
  rv.setUint16(78 + 8, 10, true);
  rv.setFloat64(78 + 10, epochMsToDelphi(latestRepMs), true);
  rv.setInt8(78 + 24, 5);

  const fs = memSourceFs({
    "info/ElementInfo.dat": elInfoBuf,
    "info/compon.dat": makeComponRecord({
      elementNumber: 1,
      components: [
        { type: 0, displayAt: 0xff, member: 1 },
        { type: 0, displayAt: 0xd7, member: 2 },
      ],
    }),
    "info/RepetitionHistory.dat": repBuf,
    "registry/text.mem": concatBytes(
      makeMemRecord(1, q.length),
      makeMemRecord(1 + q.length, a.length),
    ),
    "registry/text.ptr": makeSub([1, 2]),
    "registry/text.rtx": concatBytes(q, a),
  });

  const plan = await planSmCollectionImport({
    fs,
    nowMs: NOW,
    deviceId: DEV,
    targetFolder: "SM Import",
  });

  assert.equal(plan.stats.historyEvents, 3);
  assert.ok(plan.stats.historyReviewDateRepairs >= 2);
  assert.ok(plan.stats.historyElementInfoDateRepairs >= 2);
  assert.ok(plan.stats.historyIntervalRepairs >= 1);

  const graded = plan.events.filter((e) => e.kind === "graded");
  assert.equal(graded.length, 3);
  assert.ok(graded[0]!.ts < graded[1]!.ts);
  assert.ok(graded[1]!.ts < graded[2]!.ts);
  assert.equal(Math.round((graded[2]!.ts - latestRepMs) / 1000), 0);
  assert.equal(Math.round((plan.elements[0]!.card!.lastReview! - latestRepMs) / 1000), 0);
});
