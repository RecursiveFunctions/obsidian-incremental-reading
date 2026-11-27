import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolvePolygonVertexTap, undoDraftPolygonVertex } from "../src/ir/occlusion";
import { shouldShowSm20SchedulerOffer } from "../src/ir/settings-resolve";
import { isTabletViewport, shouldUseCompactReviewDock } from "../src/ir/viewport-tiers";

describe("Android Tablet & Mobile Polish — Pure Touch & Dock Helpers", () => {
  it("uses compact review dock on compact tiers and all mobile/tablet touch hosts", () => {
    assert.equal(shouldUseCompactReviewDock("compact", false), true);
    assert.equal(shouldUseCompactReviewDock("medium", false), false);
    assert.equal(shouldUseCompactReviewDock("expanded", false), false);
    // Android tablet in portrait (medium, 800px) and landscape (medium/expanded, 960px-1280px)
    assert.equal(shouldUseCompactReviewDock("medium", true), true);
    assert.equal(shouldUseCompactReviewDock("expanded", true), true);
  });

  it("supports touch-forgiving polygon vertex snap-to-close (6% radius on touch vs 3.5% mouse) and vertex undo", () => {
    const draft: Array<[number, number]> = [
      [0.2, 0.2],
      [0.6, 0.2],
      [0.6, 0.6],
    ];

    // A finger tap 5% away from vertex 0 misses mouse 3.5% threshold, but closes cleanly on coarse touch!
    const mouseRes = resolvePolygonVertexTap(draft, [0.248, 0.2], false);
    assert.equal(mouseRes.action, "append");
    assert.equal(mouseRes.nextDraft.length, 4);

    const touchRes = resolvePolygonVertexTap(draft, [0.248, 0.2], true);
    assert.equal(touchRes.action, "close");

    // Undo vertex pops the last point cleanly without nuking the whole polygon draft
    const popped = undoDraftPolygonVertex(mouseRes.nextDraft);
    assert.equal(popped.length, 3);
    assert.deepEqual(popped, draft);
  });

  it("detects 8-inch 800x1280 @ 240dpi Android tablets (533x853 CSS px) even when Platform.isTablet is false", () => {
    // TCL TAB 8 Plus physical hardware: 800x1280 @ 1.5x DPR -> 533x853 portrait, 853x533 landscape
    assert.equal(isTabletViewport(true, false, 533, 853), true);
    assert.equal(isTabletViewport(true, false, 853, 533), true);
    // Larger tablets where Platform.isTablet is already true
    assert.equal(isTabletViewport(true, true, 768, 1024), true);
    // Phones (360x800, 412x915, 390x844) stay false
    assert.equal(isTabletViewport(true, false, 360, 800), false);
    assert.equal(isTabletViewport(true, false, 800, 360), false);
    assert.equal(isTabletViewport(true, false, 412, 915), false);
    // Desktop hosts never match mobile tablet flag
    assert.equal(isTabletViewport(false, false, 853, 533), false);
  });

  it("suppresses the SM-20 upgrade offer modal when primaryScheduler is already sm20", () => {
    assert.equal(shouldShowSm20SchedulerOffer("sm20", false), false);
    assert.equal(shouldShowSm20SchedulerOffer("sm20", true), false);
    assert.equal(shouldShowSm20SchedulerOffer("fsrs", false), true);
    assert.equal(shouldShowSm20SchedulerOffer("fsrs", true), false);
  });
});
