import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyMobileEditLayout,
  computeMobileEditCardHeightPx,
  mobileEditTextareaFillsScroll,
  MOBILE_EDIT_MIN_HEIGHT_PX,
} from "../src/ir/mobile-edit-layout";

test("computeMobileEditCardHeightPx: card top to visible bottom", () => {
  assert.equal(computeMobileEditCardHeightPx(120, 0, 480), 360);
  assert.equal(computeMobileEditCardHeightPx(120, 0, 480, 200), 360);
});

test("computeMobileEditCardHeightPx: enforces minimum height", () => {
  assert.equal(
    computeMobileEditCardHeightPx(400, 0, 450, MOBILE_EDIT_MIN_HEIGHT_PX),
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

test("applyMobileEditLayout: sets explicit height when keyboard open", () => {
  const cardHost = {
    style: { height: "", maxHeight: "", flex: "" },
    getBoundingClientRect: () => ({ top: 100, bottom: 500, height: 400 }),
    querySelector: () => ({ clientHeight: 250 }),
  } as unknown as HTMLElement;

  Object.defineProperty(cardHost, "style", {
    value: {
      height: "",
      maxHeight: "",
      flex: "",
      setProperty(key: string, val: string) {
        (this as Record<string, string>)[key] = val;
      },
      removeProperty(key: string) {
        delete (this as Record<string, string>)[key];
      },
    },
    writable: true,
  });

  const scrollHeight = applyMobileEditLayout({
    cardHost,
    keyboardOpen: true,
    visibleTop: 0,
    visibleHeight: 420,
  });
  assert.equal((cardHost.style as { height?: string }).height, "320px");
  assert.equal(scrollHeight, 250);
});
