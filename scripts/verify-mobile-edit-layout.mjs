#!/usr/bin/env node
/**
 * Browser layout verification for mobile IR edit mode.
 * Run: npx playwright install chromium && npm run test:layout
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "../test/fixtures/mobile-edit-layout.html");
const stylesPath = path.join(__dirname, "../styles.css");
const layoutModulePath = path.join(__dirname, "../src/ir/mobile-edit-layout.ts");
const viewports = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 412, height: 915 },
  { width: 800, height: 360 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
];

function buildLayoutBundle() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ir-mobile-layout-"));
  const outfile = path.join(dir, "mobile-edit-layout.js");
  buildSync({
    entryPoints: [layoutModulePath],
    bundle: true,
    format: "iife",
    globalName: "IrMobileEditLayout",
    platform: "browser",
    target: "es2020",
    outfile,
  });
  return { dir, outfile };
}

async function main() {
  const { chromium } = await import("playwright");
  const layoutBundle = buildLayoutBundle();

  const systemChrome = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch(
    systemChrome ? { executablePath: systemChrome } : undefined,
  );
  try {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      await page.goto(`file://${fixturePath}`);
      await page.addStyleTag({ path: stylesPath });
      await page.addScriptTag({ path: layoutBundle.outfile });

      const applyLayout = function applyLayout() {
        const layoutRoot = document.getElementById("plugin-root");
        const cardHost = document.getElementById("card-host");
        return window.IrMobileEditLayout.applyMobileEditLayout(cardHost, layoutRoot);
      };

      const label = `${viewport.width}x${viewport.height}`;
      const closed = await page.evaluate(applyLayout);
      assert.ok(
        closed.fillsColumn,
        `${label} keyboard closed: column dead=${closed.columnDeadSpacePx}px`,
      );
      assert.ok(
        closed.textareaHeight >= 120, `${label} keyboard closed: textarea too short`);

      // Obsidian Android: leaf shrinks while visualViewport can remain unchanged.
      await page.evaluate(function shrinkLeaf(h) {
        const root = document.getElementById("plugin-root");
        root.style.height = `${h}px`;
        root.style.maxHeight = `${h}px`;
        root.style.overflow = "hidden";
      }, Math.max(280, Math.floor(viewport.height * 0.45)));
      const leafShrink = await page.evaluate(applyLayout);
      assert.ok(leafShrink.fillsColumn, `${label} leaf shrink: column does not fill`);
      assert.ok(leafShrink.textareaHeight >= 120, `${label} leaf shrink: textarea too short`);

      await page.evaluate(function shrinkVv({ h, width }) {
        Object.defineProperty(window, "visualViewport", {
          configurable: true,
          value: {
            offsetTop: 0,
            offsetLeft: 0,
            height: h,
            width,
            addEventListener() {},
            removeEventListener() {},
          },
        });
      }, {
        h: Math.max(280, Math.floor(viewport.height * 0.45)),
        width: viewport.width,
      });
      const open = await page.evaluate(applyLayout);
      assert.ok(open.fillsColumn, `${label} keyboard open: column does not fill`);
      assert.ok(open.textareaHeight >= 120, `${label} keyboard open: textarea too short`);
      await page.close();
    }

    console.log("OK: production mobile edit layout verified at six viewports");
  } finally {
    await browser.close();
    rmSync(layoutBundle.dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
