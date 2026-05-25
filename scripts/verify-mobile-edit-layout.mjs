#!/usr/bin/env node
/**
 * Browser layout verification for mobile IR edit mode.
 * Run: npx playwright install chromium && npm run test:layout
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "../test/fixtures/mobile-edit-layout.html");
const stylesPath = path.join(__dirname, "../styles.css");

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("SKIP: playwright not installed");
    process.exit(0);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
    await page.goto(`file://${fixturePath}`);
    await page.addStyleTag({ path: stylesPath });

    const metrics = function metrics() {
      const cardHost = document.getElementById("card-host");
      const scroll = cardHost.querySelector(".ir-review-scroll");
      const ta = cardHost.querySelector(".ir-review-textarea");
      const mainCol = cardHost.querySelector(".ir-review-main-col");
      const columnDead = mainCol.clientHeight - scroll.offsetHeight;
      const scrollFill = scroll.clientHeight - ta.offsetHeight;
      return {
        hostHeight: cardHost.offsetHeight,
        scrollHeight: scroll.clientHeight,
        textareaHeight: ta.offsetHeight,
        columnDead,
        scrollFill,
        fillsColumn: columnDead <= 4,
        fillsScroll: scrollFill <= 4,
      };
    };

    const applyKeyboard = function applyKeyboard() {
      const cardHost = document.getElementById("card-host");
      const scroll = cardHost.querySelector(".ir-review-scroll");
      const ta = cardHost.querySelector(".ir-review-textarea");
      const mainCol = cardHost.querySelector(".ir-review-main-col");
      const vv = window.visualViewport;
      const top = cardHost.getBoundingClientRect().top;
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const h = Math.max(120, Math.round(bottom - top - 8));
      cardHost.style.flex = "none";
      cardHost.style.height = h + "px";
      cardHost.style.maxHeight = h + "px";
      cardHost.style.overflow = "hidden";
      const columnDead = mainCol.clientHeight - scroll.offsetHeight;
      const scrollFill = scroll.clientHeight - ta.offsetHeight;
      return {
        hostHeight: cardHost.offsetHeight,
        scrollHeight: scroll.clientHeight,
        textareaHeight: ta.offsetHeight,
        columnDead,
        scrollFill,
        fillsColumn: columnDead <= 4,
        fillsScroll: scrollFill <= 4,
      };
    };

    const closed = await page.evaluate(metrics);
    assert.ok(
      closed.fillsColumn,
      `keyboard closed: column dead=${closed.columnDead}px scroll fill=${closed.scrollFill}px`,
    );
    assert.ok(
      closed.fillsScroll,
      `keyboard closed: textarea should fill scroll (gap=${closed.scrollFill}px)`,
    );
    assert.ok(
      closed.textareaHeight >= 400,
      `keyboard closed: textarea too short (${closed.textareaHeight}px)`,
    );

    await page.evaluate(function shrinkVv(h) {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: {
          offsetTop: 0,
          height: h,
          width: 412,
          addEventListener: function () {},
          removeEventListener: function () {},
        },
      });
    }, 380);

    const open = await page.evaluate(applyKeyboard);
    assert.ok(
      open.fillsColumn,
      `keyboard open: column dead=${open.columnDead}px (must not leave white band)`,
    );
    assert.ok(
      open.fillsScroll,
      `keyboard open: textarea should fill scroll (gap=${open.scrollFill}px)`,
    );
    assert.ok(
      open.textareaHeight >= 200,
      `keyboard open: textarea too short (${open.textareaHeight}px)`,
    );
    assert.ok(
      open.hostHeight >= 200,
      `keyboard open: host too short (${open.hostHeight}px)`,
    );

    await page.screenshot({
      path: path.join(__dirname, "../.layout-verify-keyboard.png"),
    });
    console.log("OK: mobile edit layout verified in browser");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
