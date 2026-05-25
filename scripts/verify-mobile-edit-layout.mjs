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

    const applyLayout = function applyLayout() {
      const layoutRoot = document.getElementById("plugin-root");
      const cardHost = document.getElementById("card-host");
      const scroll = cardHost.querySelector(".ir-review-scroll");
      const ta = cardHost.querySelector(".ir-review-textarea");
      const mainCol = cardHost.querySelector(".ir-review-main-col");
      const layoutRect = layoutRoot.getBoundingClientRect();
      const vv = window.visualViewport;
      const vvBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const visibleBottom = Math.min(vvBottom, layoutRect.bottom);
      const top = Math.round(layoutRect.top);
      const h = Math.max(120, Math.round(visibleBottom - top - 8));
      const width = Math.round(layoutRect.width);
      cardHost.style.position = "fixed";
      cardHost.style.top = top + "px";
      cardHost.style.left = Math.round(layoutRect.left) + "px";
      cardHost.style.width = width + "px";
      cardHost.style.height = h + "px";
      cardHost.style.maxHeight = h + "px";
      cardHost.style.flex = "none";
      cardHost.style.overflow = "hidden";
      scroll.style.flex = "none";
      scroll.style.height = h + "px";
      scroll.style.maxHeight = h + "px";
      scroll.style.display = "flex";
      scroll.style.flexDirection = "column";
      scroll.style.overflow = "hidden";
      ta.style.flex = "none";
      ta.style.height = h + "px";
      ta.style.maxHeight = h + "px";
      ta.style.minHeight = "0";
      ta.style.margin = "0";
      ta.style.overflowY = "auto";
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

    const closed = await page.evaluate(applyLayout);
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

    // Obsidian Android: leaf shrinks, visualViewport may not.
    await page.evaluate(function shrinkLeaf() {
      const root = document.getElementById("plugin-root");
      root.style.height = "380px";
      root.style.maxHeight = "380px";
      root.style.overflow = "hidden";
    });

    const leafShrink = await page.evaluate(applyLayout);
    assert.ok(
      leafShrink.fillsColumn,
      `leaf shrink: column dead=${leafShrink.columnDead}px (must not leave white band)`,
    );
    assert.ok(
      leafShrink.fillsScroll,
      `leaf shrink: textarea should fill scroll (gap=${leafShrink.scrollFill}px)`,
    );
    assert.ok(
      leafShrink.textareaHeight >= 200,
      `leaf shrink: textarea too short (${leafShrink.textareaHeight}px)`,
    );
    assert.ok(
      leafShrink.hostHeight >= 200,
      `leaf shrink: host too short (${leafShrink.hostHeight}px)`,
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

    const open = await page.evaluate(applyLayout);
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
