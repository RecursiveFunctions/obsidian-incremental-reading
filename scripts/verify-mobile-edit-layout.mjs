#!/usr/bin/env node
/**
 * Browser layout verification for mobile IR edit mode.
 * Run: npx playwright install chromium && npm run test:layout
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "../test/fixtures/mobile-edit-layout.html");
const stylesPath = path.join(__dirname, "../styles.css");

async function main() {
  const { chromium } = await import("playwright");

  const systemChrome = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch(
    systemChrome ? { executablePath: systemChrome } : undefined,
  );
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

    await page.setContent(`<!doctype html><style>:root{--radius-s:4px;--radius-m:8px;--font-ui-small:14px;--font-ui-smaller:12px;--text-normal:#ddd;--text-muted:#aaa;--text-faint:#777;--text-accent:#7aa2f7;--background-primary:#222;--background-secondary:#2a2a2a;--interactive-accent:#7aa2f7;--shadow-s:0 1px 2px #0004}</style><body><div class="ir-tree-view ir-tree--mobile">
      <div class="ir-collection-header"><h4>Collection</h4><div class="ir-collection-controls">
        <div class="ir-collection-segments"><button class="ir-collection-segment is-active">Priority</button><button class="ir-collection-segment">Sources</button></div>
        <div class="ir-collection-actions"><button class="ir-collection-filter-button">Filters</button><button class="ir-collection-icon-button">B</button></div>
      </div></div><div class="ir-collection-search"><input class="ir-collection-search-input"></div>
      <ul class="ir-tree-root"><li class="ir-tree-node"><div class="ir-tree-row ir-collection-row ir-collection-row--priority">
        <div class="ir-collection-row-content"><div class="ir-collection-row-primary"><span class="ir-collection-rank">#123</span><span class="ir-tree-title">A very long article title that must truncate without forcing horizontal scrolling</span><span class="ir-collection-percentage">18.4000</span></div>
        <div class="ir-collection-row-secondary"><span>Topic</span><span>Tomorrow</span><span class="ir-collection-breadcrumb">Root source with a very long breadcrumb › Parent extract</span></div></div>
      </div></li></ul></div></body>`);
    await page.addStyleTag({ path: stylesPath });
    const collection = await page.evaluate(() => {
      const root = document.querySelector(".ir-tree-view");
      const controls = [...document.querySelectorAll(".ir-collection-segment, .ir-collection-icon-button")];
      return {
        overflow: root.scrollWidth - root.clientWidth,
        minTarget: Math.min(...controls.map((element) => element.getBoundingClientRect().height)),
        rowHeight: document.querySelector(".ir-collection-row--priority").getBoundingClientRect().height,
      };
    });
    assert.ok(collection.overflow <= 1, `collection: horizontal overflow ${collection.overflow}px`);
    assert.ok(collection.minTarget >= 44, `collection: mobile target too short (${collection.minTarget}px)`);
    assert.ok(collection.rowHeight >= 55, `collection: priority row too short (${collection.rowHeight}px)`);

    // Verify Touch Selection Bar in bottom dock (0 overlap with prose) + multi-tier Source/Stats (#62-#65)
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setContent(`<!doctype html><style>body{margin:0}:root{--radius-s:4px;--radius-m:8px;--radius-l:12px;--font-ui-small:14px;--font-ui-smaller:12px;--font-ui-medium:15px;--font-ui-large:18px;--text-normal:#ddd;--text-muted:#aaa;--text-faint:#777;--text-accent:#7aa2f7;--text-on-accent:#fff;--background-primary:#222;--background-secondary:#2a2a2a;--background-secondary-alt:#303030;--background-modifier-border:#444;--background-modifier-hover:#383838;--interactive-accent:#7aa2f7;--color-orange:#e0af68}</style>
      <div class="ir-review-modal" data-ir-tier="compact" data-ir-pointer="coarse" style="height:812px;display:flex;flex-direction:column">
        <div class="ir-review-card-host" style="flex:1;display:flex;flex-direction:column;min-height:0">
          <div class="ir-review-columns ir-review-columns--compact" style="flex:1;min-height:0">
            <div class="ir-review-context-col ir-review-context-col--sheet">Source excerpt</div>
            <div class="ir-review-main-col" style="flex:1"><p id="sel-target">Selected paragraph in review card</p></div>
          </div>
          <div class="ir-review-dock">
            <div class="ir-telemetry-drawer ir-telemetry-drawer--sheet">
              <div class="ir-telemetry-grid"><div class="ir-telemetry-cell"><div class="ir-telemetry-cell-label">R</div><div class="ir-telemetry-cell-value">91.4%</div></div></div>
            </div>
            <div class="ir-review-touch-sel-bar">
              <button class="ir-review-touch-sel-btn mod-cta">Extract</button>
              <button class="ir-review-touch-sel-btn">Cloze</button>
              <button class="ir-review-touch-sel-btn">+ Hold span</button>
            </div>
          </div>
        </div>
      </div>`);
    await page.addStyleTag({ path: stylesPath });
    const phoneDock = await page.evaluate(() => {
      const prose = document.getElementById("sel-target").getBoundingClientRect();
      const bar = document.querySelector(".ir-review-touch-sel-bar").getBoundingClientRect();
      const btns = [...document.querySelectorAll(".ir-review-touch-sel-btn")];
      return {
        noOverlap: bar.top >= prose.bottom,
        minBtnHeight: Math.min(...btns.map((b) => b.getBoundingClientRect().height)),
      };
    });
    assert.ok(phoneDock.noOverlap, "phone touch selection bar must sit below prose in bottom dock");
    assert.ok(phoneDock.minBtnHeight >= 44, `touch selection buttons must be >=44px (${phoneDock.minBtnHeight}px)`);

    // Portrait tablet (820x1180): medium collapsible rail sits side-by-side without horizontal overflow
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.setContent(`<!doctype html><style>body{margin:0}</style>
      <div class="ir-review-modal" data-ir-tier="medium" data-ir-pointer="coarse" style="width:820px">
        <div class="ir-review-columns ir-review-columns--medium">
          <div class="ir-review-context-col ir-review-context-col--collapsible-rail">Source rail</div>
          <div class="ir-review-main-col" style="flex:1">Main reading column</div>
        </div>
      </div>`);
    await page.addStyleTag({ path: stylesPath });
    const tabletRail = await page.evaluate(() => {
      const root = document.querySelector(".ir-review-modal");
      const rail = document.querySelector(".ir-review-context-col--collapsible-rail").getBoundingClientRect();
      const main = document.querySelector(".ir-review-main-col").getBoundingClientRect();
      return {
        overflow: root.scrollWidth - root.clientWidth,
        sideBySide: Math.abs(rail.top - main.top) < 2 && main.left >= rail.right - 1,
        railWidth: rail.width,
      };
    });
    assert.ok(tabletRail.overflow <= 1, `tablet medium rail overflow ${tabletRail.overflow}px`);
    assert.ok(tabletRail.sideBySide, "tablet medium rail must sit beside main column");
    assert.ok(tabletRail.railWidth >= 220 && tabletRail.railWidth <= 345, `unexpected rail width ${tabletRail.railWidth}px`);

    // Narrow 320px desktop sidebar: segmented Stats + scrollable 26w heatmap never overflows outer view
    await page.setViewportSize({ width: 320, height: 900 });
    await page.setContent(`<!doctype html><style>body{margin:0}</style>
      <div class="ir-stats-view" data-ir-tier="compact" data-ir-pointer="fine" style="width:320px;overflow-x:hidden">
        <div class="ir-stats-tabs"><button class="ir-stats-tab is-active">Overview</button><button class="ir-stats-tab">Triage</button><button class="ir-stats-tab">Models & SM-20</button></div>
        <div class="ir-stats-heatmap-scroll"><div class="ir-stats-heatmap-grid" style="width:420px;height:80px"></div></div>
      </div>`);
    await page.addStyleTag({ path: stylesPath });
    const narrowStats = await page.evaluate(() => {
      const view = document.querySelector(".ir-stats-view");
      const scroll = document.querySelector(".ir-stats-heatmap-scroll");
      return {
        viewOverflow: view.scrollWidth - view.clientWidth,
        innerScrollable: scroll.scrollWidth > scroll.clientWidth,
      };
    });
    assert.ok(narrowStats.viewOverflow <= 1, `narrow stats view overflow ${narrowStats.viewOverflow}px`);
    assert.ok(narrowStats.innerScrollable, "26w heatmap must scroll inside .ir-stats-heatmap-scroll");

    // Narrow 360px phone/compact leaf: SM-20 6-point dock renders as 2x3 Fail/Pass grid with >=44px tap targets & intact suggested cell
    await page.setViewportSize({ width: 360, height: 800 });
    await page.setContent(`<!doctype html><style>body{margin:0}</style>
      <div class="ir-review-modal ir-review--mobile" data-ir-tier="compact" style="width:360px;overflow-x:hidden">
        <div class="ir-quiz-block ir-quiz-mcq">
          <div class="ir-quiz-prompt">Which neurotransmitter is excitatory?</div>
          <div class="ir-quiz-options">
            <button class="ir-quiz-option is-correct"><span class="ir-quiz-option-num">1</span><span class="ir-quiz-option-text">Glutamate</span></button>
          </div>
        </div>
        <div class="ir-review-buttons ir-review-buttons--grade ir-review-buttons--six-point">
          <button class="ir-review-grade-btn ir-review-grade-btn--again" data-sm-group="fail"><span class="ir-review-grade-interval">+1d</span><span>0 · Null</span></button>
          <button class="ir-review-grade-btn ir-review-grade-btn--again" data-sm-group="fail"><span class="ir-review-grade-interval">+1d</span><span>1 · Bad</span></button>
          <button class="ir-review-grade-btn ir-review-grade-btn--again" data-sm-group="fail"><span class="ir-review-grade-interval">+1d</span><span>2 · Fail</span></button>
          <button class="ir-review-grade-btn ir-review-grade-btn--hard" data-sm-group="pass"><span class="ir-review-grade-interval">+3d</span><span>3 · Pass</span></button>
          <button class="ir-review-grade-btn ir-review-grade-btn--good ir-review-grade-btn--suggested" data-sm-group="pass"><span class="ir-review-grade-interval">+7d</span><span>4 · Good</span></button>
          <button class="ir-review-grade-btn ir-review-grade-btn--easy" data-sm-group="pass"><span class="ir-review-grade-interval">+14d</span><span>5 · Bright</span></button>
          <button class="ir-review-overflow-btn">⋯</button>
        </div>
      </div>`);
    await page.addStyleTag({ path: stylesPath });
    const sixPointLayout = await page.evaluate(() => {
      const root = document.querySelector(".ir-review-modal");
      const btns = Array.from(document.querySelectorAll(".ir-review-grade-btn")).map((b) => b.getBoundingClientRect());
      return {
        overflow: root.scrollWidth - root.clientWidth,
        row1SameTop: Math.abs(btns[0].top - btns[1].top) < 2 && Math.abs(btns[1].top - btns[2].top) < 2,
        row2SameTop: Math.abs(btns[3].top - btns[4].top) < 2 && Math.abs(btns[4].top - btns[5].top) < 2,
        twoRows: btns[3].top >= btns[0].bottom - 1,
        minHeight: Math.min(...btns.map((b) => b.height)),
      };
    });
    assert.ok(sixPointLayout.overflow <= 1, `6-point compact dock overflow ${sixPointLayout.overflow}px`);
    assert.ok(sixPointLayout.row1SameTop && sixPointLayout.row2SameTop && sixPointLayout.twoRows, "6-point compact dock must form a 2x3 Fail/Pass grid");
    assert.ok(sixPointLayout.minHeight >= 44, `6-point tap target height ${sixPointLayout.minHeight}px < 44px`);

    console.log("OK: phone, tablet, narrow desktop split, SM-20 2x3 6-point dock, and Collection layouts verified in browser");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
