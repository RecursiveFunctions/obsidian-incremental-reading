import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancelPendingClozeHint,
  registerPendingClozeHint,
} from "../src/ir/cloze-hint-prompt";

test("replacing an inline hint resolves the prior prompt", async () => {
  const host = {};
  let resolvePrior: (value: { ok: false }) => void;
  const prior = new Promise<{ ok: false }>((resolve) => {
    resolvePrior = resolve;
  });
  const unregister = registerPendingClozeHint(host, () => {
    resolvePrior({ ok: false });
  });

  cancelPendingClozeHint(host);

  assert.deepEqual(await prior, { ok: false });
  unregister();
});

test("old prompt cleanup cannot unregister its replacement", () => {
  const host = {};
  const unregisterOld = registerPendingClozeHint(host, () => {});
  let cancelledNew = false;
  registerPendingClozeHint(host, () => {
    cancelledNew = true;
  });

  unregisterOld();
  cancelPendingClozeHint(host);

  assert.equal(cancelledNew, true);
});
