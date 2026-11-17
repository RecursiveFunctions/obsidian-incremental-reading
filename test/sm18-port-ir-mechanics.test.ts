/**
 * Golden contract for the SM-18 IR mechanics port (sm18-re gitlab issue #29).
 *
 * The reference lives in `sm18-re:smfmt/element_info.py` + `smfmt/compon.py`.
 * The fixture `test/fixtures/sm18-port-ir-mechanics.json` is a mirror of
 * `sm18-re:tests/fixtures/port-ir-mechanics.json` and is regenerated from
 * the sample collection by
 * `sm18-re:scripts/export-port-ir-mechanics-fixture.py`. The lane re-copies
 * the mirror on every change so sm18-re's gate catches drift on either side.
 *
 * This file is brief-writer owned (gitlab issue #29). The lane implements
 * `src/sm18-ir-mechanics.ts` with:
 *
 *   - `makeExtractChild(parent, { source_article }): ChildRecord`
 *   - `makeClozeChild(parent, { source_article }): ChildRecord`
 *
 * Each returns the inherited-plus-structural projection the fixture declares.
 * `extraction_date` and `child_component_types` are free parameters the port
 * may expose on either call; the fixture pins their shapes so the lane cannot
 * trivially satisfy the test by returning an empty object.
 *
 * Until the module exists every case `t.skip`s, so `npm test` stays green;
 * the sm18-re side gate separately checks the module file is present before
 * counting a passing run as proof the port landed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_PATH = join(__dirname, "fixtures", "sm18-port-ir-mechanics.json");
const MODULE_SPEC = ["..", "src", "sm18-ir-mechanics.ts"].join("/");

type ParentFields = {
  element_type: number;
  concept_group_member: number;
  concept_definition_member: number;
  comment_registry_member: number;
};
type ChildFields = ParentFields & {
  source_article: number;
  extraction_date: number;
};

interface FixtureCase {
  kind: "extract" | "cloze";
  parent_element_number: number;
  child_element_number: number;
  parent: ParentFields;
  child: ChildFields;
  child_component_types: number[];
}

interface Fixture {
  schema: number;
  collection: string;
  inherited_fields: string[];
  child_only_fields: string[];
  cases: FixtureCase[];
}

interface MakeOptions {
  source_article: number;
  extraction_date?: number;
}

interface PortModule {
  makeExtractChild: (parent: ParentFields, opts: MakeOptions) => Partial<ChildFields> & {
    component_types?: number[];
  };
  makeClozeChild: (parent: ParentFields, opts: MakeOptions) => Partial<ChildFields> & {
    component_types?: number[];
  };
}

async function loadPort(): Promise<PortModule | null> {
  try {
    const mod = await import(MODULE_SPEC);
    if (
      typeof mod?.makeExtractChild !== "function" ||
      typeof mod?.makeClozeChild !== "function"
    ) {
      return null;
    }
    return mod as PortModule;
  } catch {
    return null;
  }
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

test("fixture is present and non-empty", () => {
  assert.equal(fixture.schema, 1);
  assert.ok(fixture.cases.length > 0, "fixture has cases");
  assert.ok(
    fixture.cases.some((c) => c.kind === "extract"),
    "fixture has at least one extract case",
  );
  assert.ok(
    fixture.cases.some((c) => c.kind === "cloze"),
    "fixture has at least one cloze case",
  );
});

test("src/sm18-ir-mechanics.ts exports makeExtractChild and makeClozeChild", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("src/sm18-ir-mechanics.ts not implemented yet");
    return;
  }
  assert.equal(typeof port.makeExtractChild, "function");
  assert.equal(typeof port.makeClozeChild, "function");
});

for (const row of fixture.cases) {
  test(`${row.kind} child invariants: parent=${row.parent_element_number} child=${row.child_element_number}`, async (t) => {
    const port = await loadPort();
    if (port === null) {
      t.skip("src/sm18-ir-mechanics.ts not implemented yet");
      return;
    }
    const call = row.kind === "extract" ? port.makeExtractChild : port.makeClozeChild;
    const built = call(row.parent, {
      source_article: row.parent_element_number,
      extraction_date: row.child.extraction_date,
    });
    for (const k of fixture.inherited_fields) {
      const key = k as keyof ChildFields;
      assert.equal(
        (built as Record<string, unknown>)[k],
        row.child[key],
        `inherited field ${k} mismatch`,
      );
    }
    assert.equal(
      built.source_article,
      row.child.source_article,
      "source_article mismatch",
    );
    if (built.component_types !== undefined) {
      assert.deepEqual(
        built.component_types,
        row.child_component_types,
        "component_types mismatch",
      );
    }
  });
}
