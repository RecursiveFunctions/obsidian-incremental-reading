/**
 * Golden contract for src/ir/anki-export.ts (DESIGN.md section 4: a
 * one-directional Anki export for the item layer, an optional escape
 * hatch with no runtime coupling).
 *
 * Claude-authored, fenced out of scope. Skips until the module exists;
 * computed specifier keeps tsc green.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newElement } from "../src/ir/model";
import type { IrElement } from "../src/ir/model";
import type { ElementId } from "../src/ir/ids";

const SPEC = ["..", "src", "ir", "anki-export.ts"].join("/");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(): Promise<any> {
  try {
    return await import(SPEC);
  } catch {
    return null;
  }
}

function item(id: string, text: string, dismissed = false): IrElement {
  const e = newElement({
    id: id as ElementId,
    type: "item",
    priority: 50,
    now: 0,
    text,
  });
  e.dismissed = dismissed;
  return e;
}

const TAB = "\t";

function world(): IrElement[] {
  return [
    // intentionally out of id order to prove the export sorts
    item("el_b", "Line one\nLine two\twith tab\r"),
    item("el_a", "The capital of {{c1::France}} is Paris."),
    item("el_c", "dismissed cloze {{c1::x}}", true), // excluded
    newElement({
      id: "el_t" as ElementId,
      type: "topic",
      priority: 50,
      now: 0,
    }), // not an item, excluded
  ];
}

test("toAnkiTsv: exact deterministic bytes", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/anki-export.ts not implemented yet");

  const expected =
    [
      "#separator:tab",
      "#html:false",
      "#notetype:Cloze",
      "#deck:IR",
      `#columns:Text${TAB}guid`,
      "#guid column:2",
      `The capital of {{c1::France}} is Paris.${TAB}el_a`,
      `Line one Line two with tab${TAB}el_b`,
    ].join("\n") + "\n";

  assert.equal(m.toAnkiTsv(world(), { deck: "IR" }), expected);
});

test("toAnkiTsv: only non-dismissed items, sorted by id", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/anki-export.ts not implemented yet");

  const out: string = m.toAnkiTsv(world(), { deck: "IR" });
  const rows = out
    .split("\n")
    .filter((l) => l && !l.startsWith("#"));
  assert.equal(rows.length, 2);
  assert.ok(rows[0].endsWith(`${TAB}el_a`));
  assert.ok(rows[1].endsWith(`${TAB}el_b`));
  assert.ok(!out.includes("el_c")); // dismissed excluded
  assert.ok(!out.includes("el_t")); // non-item excluded
});

test("toAnkiTsv: deterministic and tab/newline-safe", async (t) => {
  const m = await load();
  if (!m) return t.skip("src/ir/anki-export.ts not implemented yet");

  const a = m.toAnkiTsv(world(), { deck: "IR" });
  const b = m.toAnkiTsv(world(), { deck: "IR" });
  assert.equal(a, b);
  // no raw tab/newline may leak into a record body (would corrupt the TSV)
  for (const row of a.split("\n").filter((l: string) => l && !l.startsWith("#"))) {
    const body = row.slice(0, row.lastIndexOf(TAB));
    assert.ok(!body.includes("\n") && !body.includes("\r"));
  }
});
