/**
 * Golden contract for the SM-18 repetition-workflow port (sm18-re gitlab #35).
 *
 * The reference lives in `sm18-re:smfmt/scheduler.py`. The fixture
 * `test/fixtures/sm18-port-repetition-workflow.json` is a mirror of
 * `sm18-re:tests/fixtures/port-repetition-workflow.json` and is regenerated
 * by `sm18-re:scripts/export-port-repetition-workflow-fixture.py`. The gate
 * on sm18-re diffs both sides so drift is caught before merge.
 *
 * This file is brief-writer owned (gitlab issue #35). The lane implements
 * `src/sm18-port-repetition-workflow.ts` with an exported
 * `runSteps(startState, grades)` whose TypeScript signature mirrors a step
 * trajectory through the Python `predict(state, grade)` reference. Until
 * that module exists every case `t.skip`s, so `npm test` stays green; the
 * sm18-re side gate separately checks the module file is present before
 * counting a passing run as proof the port landed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_PATH = join(__dirname, "fixtures", "sm18-port-repetition-workflow.json");
const MODULE_SPEC = ["..", "src", "sm18-port-repetition-workflow.ts"].join("/");

interface SchedulerStatePrimitive {
  stability: number;
  difficulty: number;
  retrievability: number;
  interval: number;
  next_interval: number;
  elapsed: number;
  lapses: number;
  repetition: number;
  a_factor: number;
  graded: boolean;
  has_history: boolean;
  priority_position: number;
  kind: number;
  postpones: number;
}

interface Step {
  grade: number;
  state_after: SchedulerStatePrimitive;
}

interface Trajectory {
  trajectory_id: string;
  start_state: SchedulerStatePrimitive;
  grades: number[];
  steps: Step[];
}

interface Fixture {
  schema: string;
  state_fields: string[];
  trajectories: Trajectory[];
}

const FIXTURE: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));

const PORT_PATH = join(__dirname, MODULE_SPEC);
const PORT_PRESENT = existsSync(PORT_PATH);

type RunSteps = (
  startState: SchedulerStatePrimitive,
  grades: number[],
) => SchedulerStatePrimitive[];

async function loadRunSteps(): Promise<RunSteps | null> {
  if (!PORT_PRESENT) return null;
  const mod = await import(MODULE_SPEC);
  const fn = (mod as { runSteps?: RunSteps }).runSteps;
  return typeof fn === "function" ? fn : null;
}

const EPS = 1e-9;

function assertStateClose(
  got: SchedulerStatePrimitive,
  want: SchedulerStatePrimitive,
  ctx: string,
) {
  for (const key of Object.keys(want) as (keyof SchedulerStatePrimitive)[]) {
    const g = got[key];
    const w = want[key];
    if (typeof w === "boolean") {
      assert.equal(g, w, `${ctx}: ${String(key)} bool mismatch`);
    } else if (Number.isInteger(w)) {
      assert.equal(g, w, `${ctx}: ${String(key)} int mismatch (got ${g}, want ${w})`);
    } else {
      assert.ok(
        typeof g === "number" && Math.abs(g - (w as number)) < Math.max(EPS, Math.abs(w as number) * 1e-6),
        `${ctx}: ${String(key)} float mismatch (got ${g}, want ${w})`,
      );
    }
  }
}

for (const traj of FIXTURE.trajectories) {
  test(`repetition-workflow trajectory: ${traj.trajectory_id}`, async (t) => {
    const runSteps = await loadRunSteps();
    if (!runSteps) {
      t.skip("src/sm18-port-repetition-workflow.ts not present yet");
      return;
    }
    const got = runSteps({ ...traj.start_state }, [...traj.grades]);
    assert.equal(
      got.length,
      traj.steps.length,
      `${traj.trajectory_id}: produced ${got.length} states, want ${traj.steps.length}`,
    );
    traj.steps.forEach((step, i) => {
      assertStateClose(got[i], step.state_after, `${traj.trajectory_id}[step ${i}, grade ${step.grade}]`);
    });
  });
}
