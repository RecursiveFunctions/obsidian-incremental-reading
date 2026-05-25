import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMobileEditKeyboardLayout,
  clearMobileEditLayout,
  computeMobileEditHostHeightPx,
  MOBILE_EDIT_MIN_HEIGHT_PX,
} from "../src/ir/mobile-edit-layout";

test("computeMobileEditHostHeightPx: host top to visible bottom", () => {
  assert.equal(computeMobileEditHostHeightPx(100, 480), 372);
});

test("computeMobileEditHostHeightPx: enforces minimum height", () => {
  assert.equal(
    computeMobileEditHostHeightPx(400, 450, 8, MOBILE_EDIT_MIN_HEIGHT_PX),
    MOBILE_EDIT_MIN_HEIGHT_PX,
  );
});

test("applyMobileEditKeyboardLayout: sizes card host only", () => {
  const styleStore: Record<string, string> = {};
  const makeStyle = () => ({
    get height() {
      return styleStore.height ?? "";
    },
    set height(v: string) {
      styleStore.height = v;
    },
    flex: "",
    overflow: "",
    removeProperty(k: string) {
      delete styleStore[k];
    },
  });

  const scroll = {
    offsetHeight: 300,
    clientHeight: 300,
    style: makeStyle(),
    getBoundingClientRect: () => ({ top: 90, height: 300 }),
  };
  const ta = {
    offsetHeight: 298,
    clientHeight: 298,
    style: makeStyle(),
  };
  const mainCol = {
    clientHeight: 300,
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 90, height: 300 }),
  };
  const columns = {
    style: makeStyle(),
    querySelector: () => mainCol,
    querySelectorAll: () => [],
  };
  const hostStyle = makeStyle();
  const cardHost = {
    offsetHeight: 372,
    style: hostStyle,
    getBoundingClientRect: () => ({ top: 100, bottom: 472, height: 372 }),
    querySelector(sel: string) {
      if (sel.includes("scroll")) return scroll;
      if (sel.includes("textarea")) return ta;
      if (sel.includes("main-col")) return mainCol;
      if (sel.includes("columns")) return columns;
      return null;
    },
    querySelectorAll(sel: string) {
      if (sel.includes("scroll")) return [scroll];
      if (sel.includes("textarea")) return [ta];
      if (sel.includes("main-col")) return [mainCol];
      if (sel.includes("columns")) return [columns];
      return [];
    },
    closest: () => null,
  };

  const prevWindow = globalThis.window;
  globalThis.window = {
    visualViewport: { offsetTop: 0, height: 480 },
    innerHeight: 915,
  } as Window & typeof globalThis;

  const metrics = applyMobileEditKeyboardLayout(
    cardHost as unknown as HTMLElement,
  );
  assert.equal(styleStore.height, "372px");
  assert.equal(metrics.fillsColumn, true);
  assert.ok(!styleStore["scroll.height"]);

  clearMobileEditLayout(cardHost as unknown as HTMLElement);
  globalThis.window = prevWindow;
});
