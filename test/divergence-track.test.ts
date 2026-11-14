/**
 * The divergence bar's proportional widths (src/ir/divergence-track.ts).
 *
 * The bar must order the models by their proposal, keep every proposal
 * visible, and still sum to one full track. Pure; no I/O.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentHue, trackLabel, trackSegments } from "../src/ir/divergence-track";

const M = [
  { id: "FSRS", intervalDays: 5 },
  { id: "DSR", intervalDays: 30 },
  { id: "SM-2", intervalDays: 60 },
];

/* trackSegments                                                       */

test("trackSegments: shares sum to one in both scales", () => {
  for (const scale of ["linear", "log"] as const) {
    const segs = trackSegments(M, scale);
    const total = segs.reduce((sum, s) => sum + s.share, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `${scale} sums to ${total}`);
  }
});

test("trackSegments: linear shares are proportional to the proposals", () => {
  const segs = trackSegments(
    [
      { id: "a", intervalDays: 10 },
      { id: "b", intervalDays: 30 },
    ],
    "linear",
  );
  assert.ok(Math.abs(segs[0].share - 0.25) < 1e-9);
  assert.ok(Math.abs(segs[1].share - 0.75) < 1e-9);
});

test("trackSegments: both scales keep the proposal order", () => {
  for (const scale of ["linear", "log"] as const) {
    const segs = trackSegments(M, scale);
    assert.ok(segs[0].share < segs[1].share);
    assert.ok(segs[1].share < segs[2].share);
  }
});

test("trackSegments: a log scale keeps an extreme small proposal visible", () => {
  const members = [
    { id: "FSRS", intervalDays: 5 },
    { id: "SM-2", intervalDays: 17000 },
  ];
  const linear = trackSegments(members, "linear")[0].share;
  const log = trackSegments(members, "log")[0].share;
  assert.ok(linear < 0.001, `linear was ${linear}`);
  assert.ok(log > 0.15, `log was ${log}`);
});

test("trackSegments: all-zero proposals share the track equally", () => {
  const segs = trackSegments(
    [
      { id: "a", intervalDays: 0 },
      { id: "b", intervalDays: 0 },
    ],
    "log",
  );
  assert.ok(Math.abs(segs[0].share - 0.5) < 1e-9);
  assert.ok(Math.abs(segs[1].share - 0.5) < 1e-9);
});

test("trackSegments: negative and non-finite proposals count as zero", () => {
  const segs = trackSegments(
    [
      { id: "a", intervalDays: -5 },
      { id: "b", intervalDays: Number.NaN },
      { id: "c", intervalDays: 10 },
    ],
    "linear",
  );
  assert.ok(Math.abs(segs[2].share - 1) < 1e-9);
});

/* trackLabel                                                          */

test("trackLabel: days, months, years, and an empty interval", () => {
  assert.equal(trackLabel(10), "10d");
  assert.equal(trackLabel(90), "3mo");
  assert.equal(trackLabel(17000), "47y");
  assert.equal(trackLabel(0), "—");
});

test("trackSegments: returns the proposals smallest first", () => {
  const segs = trackSegments(
    [
      { id: "SM-2", intervalDays: 17000 },
      { id: "FSRS", intervalDays: 8 },
      { id: "DSR", intervalDays: 600 },
    ],
    "linear",
  );
  assert.deepEqual(segs.map((s) => s.id), ["FSRS", "DSR", "SM-2"]);
});

/* segmentHue                                                          */

test("segmentHue: three models span red, green and violet", () => {
  assert.deepEqual([0, 1, 2].map((i) => segmentHue(i, 3)), [0, 130, 260]);
});

test("segmentHue: a single model sits at the red end", () => {
  assert.equal(segmentHue(0, 1), 0);
});

test("segmentHue: seven models cover the ramp in even steps", () => {
  const hues = [0, 1, 2, 3, 4, 5, 6].map((i) => segmentHue(i, 7));
  assert.equal(hues[0], 0);
  assert.equal(hues[6], 260);
  assert.ok(hues.every((h, i) => i === 0 || h > hues[i - 1]));
});
