/**
 * Browser layout verification for mobile IR edit mode.
 * Run: npx playwright install chromium && npm run test:layout
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures/mobile-edit-layout.html");
const stylesPath = path.join(__dirname, "../styles.css");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return null;
  }
}

test("mobile edit layout (browser): textarea fills scroll when keyboard open", async (t) => {
  if (process.env.CI) {
    t.skip("Playwright layout test runs locally: npm run test:layout");
    return;
  }

  const pw = await loadPlaywright();
  if (!pw) {
    t.skip("playwright not installed — run: npx playwright install chromium");
    return;
  }

  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 412, height: 915 },
    });
    await page.goto(`file://${fixturePath}`);
    await page.addStyleTag({ path: stylesPath });

    const beforeKeyboard = await page.evaluate(() => {
      const cardHost = document.getElementById("card-host")!;
      const scroll = cardHost.querySelector(".ir-review-scroll") as HTMLElement;
      const ta = cardHost.querySelector(".ir-review-textarea") as HTMLElement;
      const deadSpace = scroll.clientHeight - ta.offsetHeight;
      return {
        cardHostHeight: cardHost.offsetHeight,
        scrollHeight: scroll.clientHeight,
        textareaHeight: ta.offsetHeight,
        deadSpace,
        fills: deadSpace <= 2,
      };
    });
    assert.ok(
      beforeKeyboard.fills,
      `keyboard closed: textarea should fill scroll (dead=${beforeKeyboard.deadSpace}px)`,
    );

    const afterKeyboard = await page.evaluate((visibleHeight: number) => {
      const pluginRoot = document.getElementById("plugin-root")!;
      const cardHost = document.getElementById("card-host")!;
      pluginRoot.classList.add("ir-review--keyboard-open");
      const cardTop = cardHost.getBoundingClientRect().top;
      const height = Math.max(120, Math.round(visibleHeight - cardTop));
      cardHost.style.height = `${height}px`;
      cardHost.style.maxHeight = `${height}px`;
      cardHost.style.flex = "none";
      const scroll = cardHost.querySelector(".ir-review-scroll") as HTMLElement;
      const ta = cardHost.querySelector(".ir-review-textarea") as HTMLElement;
      const deadSpace = scroll.clientHeight - ta.offsetHeight;
      return {
        cardHostHeight: cardHost.offsetHeight,
        scrollHeight: scroll.clientHeight,
        textareaHeight: ta.offsetHeight,
        deadSpace,
        fills: deadSpace <= 2,
      };
    }, 380);

    assert.ok(
      afterKeyboard.fills,
      `keyboard open: textarea must fill scroll; dead=${afterKeyboard.deadSpace}px scroll=${afterKeyboard.scrollHeight} ta=${afterKeyboard.textareaHeight}`,
    );
    assert.ok(
      afterKeyboard.deadSpace <= 2,
      `expected ≤2px dead space, got ${afterKeyboard.deadSpace}px`,
    );
    assert.ok(
      afterKeyboard.cardHostHeight >= 200,
      "card host should use space above keyboard, not collapse to a sliver",
    );

    await page.screenshot({
      path: path.join(__dirname, "../.layout-verify-keyboard.png"),
      fullPage: false,
    });
  } finally {
    await browser.close();
  }
});
