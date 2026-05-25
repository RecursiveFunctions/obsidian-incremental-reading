import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMobileEditLayout,
  clearMobileEditLayout,
  computeMobileEditHostHeightPx,
  isMobileEditViewportCompressed,
  MOBILE_EDIT_MIN_HEIGHT_PX,
  readEffectiveVisibleBottom,
  resetMobileEditLayoutBaseline,
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

test("readEffectiveVisibleBottom: uses min of vv and layout root", () => {
  const prevWindow = globalThis.window;
  const layoutRoot = {
    getBoundingClientRect: () => ({ bottom: 420 }),
  } as HTMLElement;

  globalThis.window = {
    visualViewport: { offsetTop: 0, height: 480, width: 412 },
    innerHeight: 915,
    innerWidth: 412,
  } as Window & typeof globalThis;

  assert.equal(readEffectiveVisibleBottom(layoutRoot), 420);

  globalThis.window = prevWindow;
});

test("isMobileEditViewportCompressed: leaf shrink without vv shrink", () => {
  resetMobileEditLayoutBaseline();
  const prevWindow = globalThis.window;
  globalThis.window = {
    visualViewport: { offsetTop: 0, height: 650, width: 412 },
    innerHeight: 915,
    innerWidth: 412,
  } as Window & typeof globalThis;

  const fullRoot = {
    getBoundingClientRect: () => ({ bottom: 650 }),
  } as HTMLElement;
  assert.equal(isMobileEditViewportCompressed(fullRoot), false);

  const shrunkRoot = {
    getBoundingClientRect: () => ({ bottom: 380 }),
  } as HTMLElement;
  assert.equal(isMobileEditViewportCompressed(shrunkRoot), true);

  globalThis.window = prevWindow;
  resetMobileEditLayoutBaseline();
});

test("applyMobileEditLayout: fixed host + explicit scroll/textarea heights", () => {
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
    position: "",
    top: "",
    left: "",
    width: "",
    maxHeight: "",
    zIndex: "",
    removeProperty(k: string) {
      delete styleStore[k];
    },
  });

  const taStyle = makeStyle();
  const scrollStyle = makeStyle();
  const scroll = {
    offsetHeight: 300,
    clientHeight: 300,
    style: scrollStyle,
    getBoundingClientRect: () => ({ top: 90, height: 300 }),
  };
  const ta = {
    offsetHeight: 298,
    clientHeight: 298,
    style: taStyle,
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
      if (sel.includes("topbar")) return null;
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
  const layoutRoot = {
    getBoundingClientRect: () => ({ top: 48, left: 0, width: 412, bottom: 480 }),
  } as HTMLElement;

  const prevWindow = globalThis.window;
  globalThis.window = {
    visualViewport: { offsetTop: 0, height: 480 },
    innerHeight: 915,
    innerWidth: 412,
  } as Window & typeof globalThis;

  const metrics = applyMobileEditLayout(
    cardHost as unknown as HTMLElement,
    layoutRoot,
  );
  assert.equal(hostStyle.position, "fixed");
  assert.equal(styleStore.height, "424px");
  assert.equal(scrollStyle.height, "424px");
  assert.equal(taStyle.height, "424px");
  assert.equal(metrics.fillsColumn, true);

  clearMobileEditLayout(cardHost as unknown as HTMLElement);
  globalThis.window = prevWindow;
});
