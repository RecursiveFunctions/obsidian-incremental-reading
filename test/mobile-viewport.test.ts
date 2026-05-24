import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampRadialOrigin,
  radialAnchorCenterBottom,
  type MobileViewportInsets,
} from "../src/ir/mobile-viewport";

const phonePortrait: MobileViewportInsets = {
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  layoutWidth: 400,
  layoutHeight: 800,
  visibleTop: 0,
  visibleLeft: 0,
  visibleWidth: 400,
  visibleHeight: 800,
};

test("radialAnchorCenterBottom stays above bottom chrome on portrait", () => {
  const { cy } = radialAnchorCenterBottom(phonePortrait);
  assert.ok(cy < phonePortrait.visibleHeight - 100);
});

test("clampRadialOrigin keeps disk inside visible area", () => {
  const clamped = clampRadialOrigin(
    { cx: 10, cy: 900 },
    phonePortrait,
    160,
  );
  assert.ok(clamped.cx >= 160 + 12);
  assert.ok(clamped.cy < phonePortrait.visibleHeight - 80);
});

test("clampRadialOrigin respects landscape height", () => {
  const landscape: MobileViewportInsets = {
    ...phonePortrait,
    layoutWidth: 800,
    layoutHeight: 400,
    visibleWidth: 800,
    visibleHeight: 400,
  };
  const clamped = clampRadialOrigin({ cx: 400, cy: 380 }, landscape, 160);
  assert.ok(clamped.cy <= landscape.visibleHeight - 80);
});
