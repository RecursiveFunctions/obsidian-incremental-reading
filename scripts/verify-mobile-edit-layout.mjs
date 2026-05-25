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
      const cardHost = document.getElementById("card-host");
      const scroll = cardHost.querySelector(".ir-review-scroll");
      const ta = cardHost.querySelector(".ir-review-textarea");
      const layoutRoot =
        cardHost.closest(".ir-review-layout") || cardHost;
      const vv = window.visualViewport;
      const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
      const scrollTop = scroll.getBoundingClientRect().top;
      const layoutBottom = layoutRoot.getBoundingClientRect().bottom;
      const clipBottom = Math.min(visibleBottom, layoutBottom);
      const height = Math.max(120, Math.round(clipBottom - scrollTop - 8));

      scroll.style.flex = "none";
      scroll.style.height = height + "px";
      scroll.style.minHeight = height + "px";
      scroll.style.maxHeight = height + "px";
      ta.style.display = "block";
      ta.style.width = "100%";
      ta.style.boxSizing = "border-box";
      ta.style.height = height + "px";
      ta.style.minHeight = height + "px";
      ta.style.maxHeight = height + "px";
      ta.style.margin = "0";
      ta.style.resize = "none";

      const deadSpace = scroll.clientHeight - ta.offsetHeight;
      return {
        computedHeight: height,
        scrollHeight: scroll.clientHeight,
        textareaHeight: ta.offsetHeight,
        deadSpace,
        fills: deadSpace <= 2,
      };
    };

    const before = await page.evaluate(applyLayout);
    assert.equal(before.fills, true, "keyboard closed should fill");

    await page.evaluate(function shrinkVv(visibleHeight) {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: {
          offsetTop: 0,
          height: visibleHeight,
          width: 412,
          addEventListener: function () {},
          removeEventListener: function () {},
        },
      });
    }, 380);

    const afterVv = await page.evaluate(applyLayout);
    assert.equal(afterVv.fills, true, "vv shrink should fill");
    assert.ok(afterVv.textareaHeight >= 200);

    await page.evaluate(function shrinkLeaf() {
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: {
          offsetTop: 0,
          height: 915,
          width: 412,
          addEventListener: function () {},
          removeEventListener: function () {},
        },
      });
      const root = document.getElementById("plugin-root");
      root.style.height = "380px";
      root.style.flex = "none";
    });

    const afterLeaf = await page.evaluate(applyLayout);
    assert.equal(afterLeaf.fills, true, "leaf shrink without vv should fill");
    assert.ok(afterLeaf.textareaHeight >= 200);
    assert.ok(afterLeaf.deadSpace <= 2);

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
