/**
 * Mobile swipe gestures for the IR review pane (Option B).
 *
 * Pre-reveal (cloze hidden): ← previous · → next
 * Post-reveal / gradeable items: ← Again · → Good
 * Reading (topics/extracts): ← previous · → next
 *
 * Swipes are scoped to `.ir-review-swipe-zone` inside our custom ItemView —
 * not the Obsidian editor — and ignore touches that start within
 * `edgeDeadZonePx` of the viewport sides so we don't fight the sidebar
 * edge-swipe chrome. No two-finger gestures (iOS tab switcher conflict).
 *
 * Pure helpers are unit-tested; `attachReviewSwipeGestures` wires the DOM.
 */

import type { Grade } from "../fsrs";

/** Device-local dismissal keys for the mobile review swipe coaching. */
export const MOBILE_REVIEW_TIP_KEYS = [
  "incremental-reading:swipe-legend-seen",
  "incremental-reading:swipe-coach-shown",
] as const;

export const MOBILE_REVIEW_SWIPE_TIP_DISMISSED_KEY = MOBILE_REVIEW_TIP_KEYS[0];

/** Reset mobile swipe coaching on this device without touching plugin data. */
export function resetMobileReviewTips(
  storage: Pick<Storage, "removeItem"> = window.localStorage,
): void {
  for (const key of MOBILE_REVIEW_TIP_KEYS) storage.removeItem(key);
}

/** Pixels from the left/right viewport edge where we refuse to start a swipe. */
export const SWIPE_EDGE_DEAD_ZONE_PX = 32;

/** Minimum travel before we lock onto a cardinal direction. */
export const SWIPE_COMMIT_DISTANCE_PX = 48;

/** Horizontal movement must beat vertical by this margin to steal the gesture. */
export const SWIPE_AXIS_DOMINANCE_PX = 12;

export type SwipeDirection = "left" | "right";

export type ReviewSwipeMode = "reading" | "nav" | "grade";

export type SwipeNavAction = "previous" | "next" | "reveal";

export type SwipeOutcome =
  | { kind: "nav"; action: SwipeNavAction }
  | { kind: "grade"; grade: Grade };

export function touchStartsInEdgeDeadZone(
  clientX: number,
  viewportWidth: number,
  edgePx = SWIPE_EDGE_DEAD_ZONE_PX,
): boolean {
  return clientX < edgePx || clientX > viewportWidth - edgePx;
}

/**
 * Pick a horizontal direction once movement is committed. Vertical movement
 * always belongs to the card scroller.
 */
export function classifySwipeDirection(
  dx: number,
  dy: number,
  minDist = SWIPE_COMMIT_DISTANCE_PX,
  axisMargin = SWIPE_AXIS_DOMINANCE_PX,
): SwipeDirection | null {
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < minDist || adx < ady + axisMargin) return null;
  return dx < 0 ? "left" : "right";
}

export function reviewSwipeMode(
  isReading: boolean,
  isCloze: boolean,
  revealed: boolean,
): ReviewSwipeMode {
  if (isReading) return "reading";
  if (isCloze && !revealed) return "nav";
  return "grade";
}

export function swipeOutcomeFor(
  mode: ReviewSwipeMode,
  dir: SwipeDirection,
): SwipeOutcome | null {
  if (mode === "reading") {
    if (dir === "left") return { kind: "nav", action: "previous" };
    if (dir === "right") return { kind: "nav", action: "next" };
    return null;
  }
  if (mode === "nav") {
    if (dir === "left") return { kind: "nav", action: "previous" };
    if (dir === "right") return { kind: "nav", action: "next" };
    return null;
  }
  // Hard and Easy remain available as visible grade buttons.
  if (dir === "left") return { kind: "grade", grade: "again" };
  if (dir === "right") return { kind: "grade", grade: "good" };
  return null;
}

const GRADE_LABELS: Record<Grade, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

const NAV_LABELS: Record<SwipeNavAction, string> = {
  previous: "Previous",
  next: "Next",
  reveal: "Show answer",
};

export function swipeHintLabel(outcome: SwipeOutcome): string {
  if (outcome.kind === "grade") {
    return outcome.grade === "again"
      ? `← ${GRADE_LABELS[outcome.grade]}`
      : `${GRADE_LABELS[outcome.grade]} →`;
  }
  return outcome.action === "previous"
    ? `← ${NAV_LABELS[outcome.action]}`
    : `${NAV_LABELS[outcome.action]} →`;
}

const INTERACTIVE_SEL =
  "button, a, input, select, textarea, label, [contenteditable='true'], .ir-review-fab, .ir-review-hub-btn";

export interface ReviewSwipeGestureCallbacks {
  getMode: () => ReviewSwipeMode;
  isBlocked: () => boolean;
  onOutcome: (outcome: SwipeOutcome) => void;
}

/**
 * Attach pointer-driven swipe handling to `root`. Returns a cleanup function.
 * Call once from `IrReviewView.onOpen` on mobile; uses event delegation so
 * `renderCard` can rebuild the swipe zone without re-attaching.
 */
export function attachReviewSwipeGestures(
  root: HTMLElement,
  hintEl: HTMLElement,
  callbacks: ReviewSwipeGestureCallbacks,
): () => void {
  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let locked: SwipeDirection | null = null;

  const hideHint = () => {
    hintEl.removeClass("is-visible");
    hintEl.empty();
  };

  const showHint = (outcome: SwipeOutcome) => {
    hintEl.setText(swipeHintLabel(outcome));
    hintEl.addClass("is-visible");
  };

  const reset = () => {
    pointerId = null;
    locked = null;
    hideHint();
  };

  const onPointerDown = (evt: PointerEvent) => {
    if (callbacks.isBlocked()) return;
    if (evt.pointerType === "mouse" && evt.button !== 0) return;
    if (!evt.isPrimary) return;
    const target = evt.target as HTMLElement | null;
    if (!target?.closest(".ir-review-swipe-zone")) return;
    if (target.closest(INTERACTIVE_SEL)) return;
    const selection = root.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) return;
    const vw = root.ownerDocument.defaultView?.innerWidth ?? window.innerWidth;
    if (touchStartsInEdgeDeadZone(evt.clientX, vw)) return;

    pointerId = evt.pointerId;
    startX = evt.clientX;
    startY = evt.clientY;
    locked = null;
    hideHint();
  };

  const onPointerMove = (evt: PointerEvent) => {
    if (pointerId === null || evt.pointerId !== pointerId) return;
    const selection = root.ownerDocument.getSelection();
    if (selection && !selection.isCollapsed) {
      reset();
      return;
    }
    const dx = evt.clientX - startX;
    const dy = evt.clientY - startY;
    const dir =
      locked ?? classifySwipeDirection(dx, dy);
    if (!dir) return;
    if (!locked) locked = dir;
    const outcome = swipeOutcomeFor(callbacks.getMode(), dir);
    if (outcome) showHint(outcome);
    if (locked) evt.preventDefault();
  };

  const onPointerUp = (evt: PointerEvent) => {
    if (pointerId === null || evt.pointerId !== pointerId) return;
    const dx = evt.clientX - startX;
    const dy = evt.clientY - startY;
    const dir = locked ?? classifySwipeDirection(dx, dy);
    reset();
    if (!dir) return;
    const outcome = swipeOutcomeFor(callbacks.getMode(), dir);
    if (outcome) callbacks.onOutcome(outcome);
  };

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove, { passive: false });
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", reset);

  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("pointercancel", reset);
    reset();
  };
}
