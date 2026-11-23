import { test } from "node:test";
import assert from "node:assert/strict";
import { mountPlacementPriorityInput, parseCandidatePriority } from "../src/priority-prompt";

class FakeEl {
  textContent = "";
  classes = new Set<string>();
  children: FakeEl[] = [];
  onclick: (() => void) | null = null;
  private listeners = new Map<string, Set<(e: any) => void>>();

  createEl(_tag: string, opts?: { cls?: string; text?: string }): FakeEl {
    const el = new FakeEl();
    if (opts?.cls) el.classes.add(opts.cls);
    if (opts?.text !== undefined) el.textContent = opts.text;
    this.children.push(el);
    return el;
  }
  createDiv(opts?: { cls?: string }): FakeEl {
    return this.createEl("div", opts);
  }
  createSpan(opts?: { text?: string }): FakeEl {
    return this.createEl("span", opts);
  }
  empty(): void {
    this.children = [];
  }
  addClass(c: string): void {
    this.classes.add(c);
  }
  removeClass(c: string): void {
    this.classes.delete(c);
  }
  addEventListener(type: string, fn: (e: any) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, fn: (e: any) => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  focus(): void {}
}

test("placement prompt: dispose tears down without invoking cancel or commit", () => {
  const host = new FakeEl();
  let cancels = 0;
  let commits = 0;
  const handle = mountPlacementPriorityInput(host as any, {
    initial: 50,
    title: "Stage an action",
    commitLabel: "Apply",
    onCommit: () => { commits += 1; },
    onCancel: () => { cancels += 1; },
  });

  assert.equal(typeof handle.dispose, "function");
  handle.dispose();
  assert.equal(cancels, 0);
  assert.equal(commits, 0);
  handle.cancel();
  assert.equal(cancels, 0);
  assert.equal(commits, 0);
});

test("placement prompt: cancel still invokes the cancel callback", () => {
  const host = new FakeEl();
  let cancels = 0;
  const handle = mountPlacementPriorityInput(host as any, {
    initial: 50,
    title: "Stage an action",
    commitLabel: "Apply",
    onCommit: () => {},
    onCancel: () => { cancels += 1; },
  });
  handle.cancel();
  assert.equal(cancels, 1);
});

test("parseCandidatePriority: empty string returns null", () => {
  assert.equal(parseCandidatePriority(""), null);
});

test("parseCandidatePriority: whitespace-only returns null", () => {
  assert.equal(parseCandidatePriority("   "), null);
});

test("parseCandidatePriority: non-numeric returns null", () => {
  assert.equal(parseCandidatePriority("abc"), null);
});

test("parseCandidatePriority: NaN returns null", () => {
  assert.equal(parseCandidatePriority("NaN"), null);
});

test("parseCandidatePriority: Infinity returns null", () => {
  assert.equal(parseCandidatePriority("Infinity"), null);
});

test("parseCandidatePriority: valid integer in range", () => {
  assert.equal(parseCandidatePriority("42"), 42);
});

test("parseCandidatePriority: valid integer with whitespace", () => {
  assert.equal(parseCandidatePriority("  42  "), 42);
});

test("parseCandidatePriority: zero (minimum)", () => {
  assert.equal(parseCandidatePriority("0"), 0);
});

test("parseCandidatePriority: 100 (maximum)", () => {
  assert.equal(parseCandidatePriority("100"), 100);
});

test("parseCandidatePriority: negative clamped to 0", () => {
  assert.equal(parseCandidatePriority("-5"), 0);
});

test("parseCandidatePriority: over 100 clamped to 100", () => {
  assert.equal(parseCandidatePriority("150"), 100);
});

test("parseCandidatePriority: fractional value passes through clamp", () => {
  const result = parseCandidatePriority("33.7");
  assert.ok(result !== null);
  assert.ok(result >= 0 && result <= 100);
});
