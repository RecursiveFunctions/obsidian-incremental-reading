import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMobileEditLayout,
  clearMobileEditLayout,
  computeMobileEditScrollHeightPx,
  mobileEditKeyboardLikelyOpen,
  mobileEditTextareaFillsScroll,
  MOBILE_EDIT_MIN_HEIGHT_PX,
} from "../src/ir/mobile-edit-layout";

test("computeMobileEditScrollHeightPx: scroll top to visible bottom", () => {
  assert.equal(computeMobileEditScrollHeightPx(140, 480, 900), 332);
});

test("computeMobileEditScrollHeightPx: clips to shrunk layout root (Obsidian leaf)", () => {
  // Keyboard shrinks leaf to 380px bottom; vv still reports 915 — use layout clip.
  assert.equal(computeMobileEditScrollHeightPx(140, 915, 380), 232);
});

test("computeMobileEditScrollHeightPx: enforces minimum height", () => {
  assert.equal(
    computeMobileEditScrollHeightPx(360, 400, 400, 8, MOBILE_EDIT_MIN_HEIGHT_PX),
    MOBILE_EDIT_MIN_HEIGHT_PX,
  );
});

test("mobileEditTextareaFillsScroll: detects dead space", () => {
  const scroll = { clientHeight: 320 } as HTMLElement;
  const tall = { offsetHeight: 318 } as HTMLElement;
  const short = { offsetHeight: 96 } as HTMLElement;
  assert.equal(mobileEditTextareaFillsScroll(scroll, tall), true);
  assert.equal(mobileEditTextareaFillsScroll(scroll, short), false);
});

test("mobileEditKeyboardLikelyOpen: detects shrink vs baseline", () => {
  assert.equal(mobileEditKeyboardLikelyOpen(280, 650), true);
  assert.equal(mobileEditKeyboardLikelyOpen(620, 650), false);
});

test("applyMobileEditLayout: sets matching scroll + textarea heights", () => {
  const styleStore: Record<string, string> = {};
  const makeStyle = (prefix: string) => ({
    get height() {
      return styleStore[`${prefix}.height`] ?? "";
    },
    set height(v: string) {
      styleStore[`${prefix}.height`] = v;
    },
    flex: "",
    setProperty(k: string, v: string) {
      styleStore[`${prefix}.${k}`] = v;
    },
    removeProperty(k: string) {
      delete styleStore[`${prefix}.${k}`];
    },
  });

  const scroll = {
    className: "ir-review-scroll",
    offsetHeight: 222,
    clientHeight: 222,
    style: makeStyle("scroll"),
    getBoundingClientRect: () => ({ top: 150, bottom: 372, height: 222 }),
    closest: () => layoutRoot,
  };
  const ta = {
    className: "ir-review-textarea",
    offsetHeight: 222,
    clientHeight: 222,
    style: makeStyle("textarea"),
    getBoundingClientRect: () => ({ top: 150, bottom: 372, height: 222 }),
  };
  const layoutRoot = {
    getBoundingClientRect: () => ({ top: 48, bottom: 380, height: 332 }),
  };
  const cardHost = {
    style: makeStyle("card"),
    querySelector(sel: string) {
      if (sel.includes("scroll")) return scroll;
      if (sel.includes("textarea")) return ta;
      return null;
    },
    querySelectorAll(sel: string) {
      if (sel.includes("scroll")) return [scroll];
      if (sel.includes("textarea")) return [ta];
      return [];
    },
    closest: () => layoutRoot,
  };

  const prevWindow = globalThis.window;
  globalThis.window = {
    visualViewport: { offsetTop: 0, height: 915 },
    innerHeight: 915,
  } as Window & typeof globalThis;

  const result = applyMobileEditLayout(cardHost as unknown as HTMLElement);
  assert.equal(result.applied, true);
  assert.equal(result.computedHeight, 222);
  assert.equal(styleStore["scroll.height"], "222px");
  assert.equal(styleStore["textarea.height"], "222px");
  assert.equal(result.fills, true);

  clearMobileEditLayout(cardHost as unknown as HTMLElement);
  globalThis.window = prevWindow;
});
