import assert from "node:assert/strict";
import test from "node:test";
import { DropWhileBusyGate } from "../src/ir/action-gate";

test("DropWhileBusyGate drops concurrent work instead of queuing it", async () => {
  const gate = new DropWhileBusyGate();
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let runs = 0;
  const first = gate.run(async () => {
    runs += 1;
    await held;
    return "first";
  });

  assert.equal(gate.isBusy, true);
  assert.equal(await gate.run(async () => "second"), undefined);
  assert.equal(runs, 1);
  release();
  assert.equal(await first, "first");
  assert.equal(gate.isBusy, false);
});
