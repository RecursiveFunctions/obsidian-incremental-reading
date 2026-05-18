import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createCloze,
  createExtract,
  getIrType,
  getPriority,
  isDismissed,
  markAsTopic,
  setDismissed,
} from "../src/ir-note";
import { IR_KEYS } from "../src/types";
import { FakeApp, fakeEditor } from "./fake-obsidian";

const SETTINGS = {
  defaultPriority: 33,
  extractFolder: "",
  topicFirstInterval: 1,
  topicAFactor: 2,
  topicMaxInterval: 1825,
};

test("markAsTopic seeds type, priority, and a fresh topic schedule; idempotent", async () => {
  const app = new FakeApp();
  const file = app.seed("Note.md");

  assert.equal(await markAsTopic(app.asApp(), file as any, SETTINGS), true);
  const fm = app.frontmatterOf("Note.md")!;
  assert.equal(fm[IR_KEYS.type], "topic");
  assert.equal(fm[IR_KEYS.priority], 33);
  assert.equal(typeof fm[IR_KEYS.due], "string");
  // Topic schedule, not an FSRS card: no interval yet, default A-Factor,
  // and no FSRS-only state key.
  assert.equal(fm[IR_KEYS.interval], 0);
  assert.equal(fm[IR_KEYS.aFactor], 2);
  assert.equal(IR_KEYS.state in fm, false);

  // Second call is a no-op and leaves an existing priority untouched.
  fm[IR_KEYS.priority] = 7;
  assert.equal(
    await markAsTopic(app.asApp(), file as any, {
      ...SETTINGS,
      defaultPriority: 99,
    }),
    false,
  );
  assert.equal(app.frontmatterOf("Note.md")![IR_KEYS.priority], 7);
});

test("getIrType and getPriority read and clamp frontmatter", () => {
  const app = new FakeApp();
  const ex = app.seed("E.md", { [IR_KEYS.type]: "extract" });
  const plain = app.seed("P.md");

  assert.equal(getIrType(app.asApp(), ex as any), "extract");
  assert.equal(getIrType(app.asApp(), plain as any), null);

  assert.equal(
    getPriority(app.asApp(), app.seed("A.md", { [IR_KEYS.priority]: 12 }) as any, 33),
    12,
  );
  assert.equal(getPriority(app.asApp(), plain as any, 33), 33);
  assert.equal(
    getPriority(app.asApp(), app.seed("B.md", { [IR_KEYS.priority]: 999 }) as any, 33),
    100,
  );
});

test("createExtract makes a child beside the source, inheriting priority", async () => {
  const app = new FakeApp();
  const src = app.seed("src/Topic.md", {
    [IR_KEYS.type]: "topic",
    [IR_KEYS.priority]: 20,
  });

  const r = await createExtract(app.asApp(), src as any, "Hello world", SETTINGS);
  assert.ok(r.file, r.error);
  assert.equal(r.file!.path, "src/Hello world.md");
  assert.equal(app.bodyOf("src/Hello world.md"), "Hello world\n");

  const fm = app.frontmatterOf("src/Hello world.md")!;
  assert.equal(fm[IR_KEYS.type], "extract");
  assert.equal(fm[IR_KEYS.parent], "src/Topic.md");
  assert.equal(fm[IR_KEYS.priority], 20);
  assert.equal(typeof fm[IR_KEYS.due], "string");
  // An extract is a reading element: topic schedule, not an FSRS card.
  assert.equal(fm[IR_KEYS.interval], 0);
  assert.equal(IR_KEYS.state in fm, false);
});

test("createExtract refuses a non-IR source and creates nothing", async () => {
  const app = new FakeApp();
  const plain = app.seed("Plain.md");
  const r = await createExtract(app.asApp(), plain as any, "text", SETTINGS);
  assert.equal(r.file, undefined);
  assert.match(r.error!, /not an IR topic/);
  assert.equal(app.has("text.md"), false);
});

test("createExtract dedupes the filename and honors the extract folder", async () => {
  const app = new FakeApp();
  const src = app.seed("Topic.md", { [IR_KEYS.type]: "topic" });
  app.seed("Box/Hello world.md", { [IR_KEYS.type]: "extract" });

  const r = await createExtract(app.asApp(), src as any, "Hello world", {
    ...SETTINGS,
    extractFolder: "Box",
  });
  assert.equal(r.file!.path, "Box/Hello world 2.md");
});

test("createExtract rejects an empty selection", async () => {
  const app = new FakeApp();
  const src = app.seed("T.md", { [IR_KEYS.type]: "topic" });
  const r = await createExtract(app.asApp(), src as any, "   ", SETTINGS);
  assert.equal(r.file, undefined);
  assert.match(r.error!, /Nothing selected/);
});

test("createCloze hides the selected span inside its line context", async () => {
  const app = new FakeApp();
  const src = app.seed("src/Topic.md", { [IR_KEYS.type]: "topic" });
  const editor = fakeEditor(
    ["The quick brown fox"],
    { line: 0, ch: 4 },
    { line: 0, ch: 9 },
  );

  const r = await createCloze(app.asApp(), src as any, editor, SETTINGS);
  assert.ok(r.file, r.error);
  assert.equal(r.file!.path, "src/quick.md");
  assert.equal(app.bodyOf("src/quick.md"), "The {{c1::quick}} brown fox\n");
  const cfm = app.frontmatterOf("src/quick.md")!;
  assert.equal(cfm[IR_KEYS.type], "item");
  assert.equal(cfm[IR_KEYS.parent], "src/Topic.md");
  // A cloze item is graded, so it gets an FSRS card, not a topic schedule.
  assert.equal(cfm[IR_KEYS.state], 0);
  assert.equal(IR_KEYS.interval in cfm, false);
});

test("createCloze keeps multi-line context", async () => {
  const app = new FakeApp();
  const src = app.seed("Topic.md", { [IR_KEYS.type]: "extract" });
  const editor = fakeEditor(
    ["alpha beta", "gamma delta"],
    { line: 0, ch: 6 },
    { line: 1, ch: 5 },
  );

  const r = await createCloze(app.asApp(), src as any, editor, SETTINGS);
  assert.ok(r.file, r.error);
  assert.equal(app.bodyOf(r.file!.path), "alpha {{c1::beta\ngamma}} delta\n");
});

test("dismiss is reversible and lossless; non-IR is refused", async () => {
  const app = new FakeApp();
  const t = app.seed("T.md", {
    [IR_KEYS.type]: "topic",
    [IR_KEYS.priority]: 40,
  });

  assert.equal(isDismissed(app.asApp(), t as any), false);
  assert.equal(await setDismissed(app.asApp(), t as any, true), true);
  assert.equal(app.frontmatterOf("T.md")![IR_KEYS.dismissed], true);
  assert.equal(isDismissed(app.asApp(), t as any), true);

  assert.equal(await setDismissed(app.asApp(), t as any, false), true);
  assert.equal(IR_KEYS.dismissed in app.frontmatterOf("T.md")!, false);
  assert.equal(app.frontmatterOf("T.md")![IR_KEYS.priority], 40);

  const plain = app.seed("P.md");
  assert.equal(await setDismissed(app.asApp(), plain as any, true), false);
});
