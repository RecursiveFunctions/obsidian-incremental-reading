import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPdfTopicEvent } from "../src/ir/pdf-topic";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";

test("buildPdfTopicEvent: store-only topic with notePath and schedule", () => {
  const sched = { due: 10, interval: 3, aFactor: 2 };
  const ev = buildPdfTopicEvent({
    path: "Papers/foo.pdf",
    elementId: "el_mig_abc" as ElementId,
    eventId: "ev_pdf_topic" as EventId,
    device: "dev_test" as DeviceId,
    lamport: 1,
    now: 1_700_000_000_000,
    priority: 50,
    schedule: sched,
  });
  assert.equal(ev.kind, "element-created");
  assert.equal(ev.target, "el_mig_abc");
  const el = ev.payload.element as {
    type: string;
    notePath: string;
    text: string;
    schedule: typeof sched;
  };
  assert.equal(el.type, "topic");
  assert.equal(el.notePath, "Papers/foo.pdf");
  assert.equal(el.text, "");
  assert.deepEqual(el.schedule, sched);
});
