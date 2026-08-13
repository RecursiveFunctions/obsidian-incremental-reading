/**
 * Status bar queue-load indicator (UI commitment #4: glanceable queue load).
 *
 * Surfaces three numbers without requiring a click: how many elements are due
 * now, how many are queued for later today, how many new elements landed in
 * the last seven days. Direct response to the SuperMemo Information Fatigue
 * Syndrome pain noted in MARKET-RESEARCH.md §8.2 and §9 feature rank #5.
 *
 * The compute function is pure (takes elements + events + now, returns three
 * counts) so it unit-tests without any Obsidian dependency. The render
 * function only touches DOM; main.ts owns the `HTMLElement` returned by
 * `addStatusBarItem()` and calls `renderStatusBar` whenever state changes.
 */

import type { IrEvent } from "./ir/model";
import type { IrElement } from "./ir/model";

export interface QueueLoad {
  /** Elements with a due time at or before `now`. */
  due: number;
  /** Elements due after `now` but on or before end-of-day local time. */
  later: number;
  /**
   * Count of `element-created` events in the last seven days. Not net of
   * dismissals or deletions; this is "inflow," tracked as a leading
   * indicator that the user is importing faster than they can process.
   */
  inflow7d: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** End of the local-time day containing `now`, in epoch ms. */
export function endOfDayMs(now: number): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function dueOf(el: IrElement): number | undefined {
  const d = el.type === "item" ? el.card?.due : el.schedule?.due;
  if (d === undefined || !Number.isFinite(d)) return undefined;
  return d;
}

export function computeLoad(
  elements: Iterable<IrElement>,
  events: Iterable<IrEvent>,
  now: number,
): QueueLoad {
  const endToday = endOfDayMs(now);
  const sevenDaysAgo = now - 7 * DAY_MS;
  let due = 0;
  let later = 0;
  for (const el of elements) {
    if (el.dismissed) continue;
    const d = dueOf(el);
    if (d === undefined) continue;
    if (d <= now) due += 1;
    else if (d <= endToday) later += 1;
  }
  let inflow7d = 0;
  for (const ev of events) {
    if (ev.kind === "element-created" && ev.ts >= sevenDaysAgo) inflow7d += 1;
  }
  return { due, later, inflow7d };
}

/** Compact text form used for the aria-label and as a render fallback. */
export function formatLoad(load: QueueLoad): string {
  return (
    `${load.due} due  ·  ${load.later} later  ·  +${load.inflow7d}/7d`
  );
}

/**
 * Render the queue-load indicator into the Obsidian status bar element. The
 * element is the one returned by `Plugin.addStatusBarItem()`; we own its
 * contents while the plugin is loaded, and `dispose` clears it on unload.
 *
 * Clicking the indicator runs `onClick` (wired in main.ts to start a review).
 * Right-click / long-press runs `onContextMenu` (tree, neural, hub, etc.).
 * The indicator's job is still glanceable display: every datum is visible
 * without interaction (commitment #4).
 */
export function renderStatusBar(
  el: HTMLElement,
  load: QueueLoad,
  onClick?: () => void,
  onContextMenu?: (evt: MouseEvent) => void,
): void {
  el.empty();
  el.addClass("ir-status-bar");
  if (load.due > 0) el.addClass("has-due");
  else el.removeClass("has-due");

  el.createSpan({ cls: "ir-status-bar-due", text: `${load.due} due` });
  el.createSpan({ cls: "ir-status-bar-sep", text: " · " });
  el.createSpan({ cls: "ir-status-bar-later", text: `${load.later} later` });
  el.createSpan({ cls: "ir-status-bar-sep", text: " · " });
  el.createSpan({
    cls: "ir-status-bar-inflow",
    text: `+${load.inflow7d}/7d`,
  });

  el.setAttribute(
    "aria-label",
    `IR queue: ${load.due} due now, ${load.later} later today, ` +
      `${load.inflow7d} added in last 7 days. Click to start review. ` +
      `Right-click for tree, neural, and other IR actions.`,
  );

  if (onClick) {
    el.onclick = () => onClick();
  } else {
    el.onclick = null;
  }
  el.oncontextmenu = onContextMenu
    ? (evt) => onContextMenu(evt)
    : null;
}

export function disposeStatusBar(el: HTMLElement): void {
  el.empty();
  el.removeClass("ir-status-bar");
  el.removeClass("has-due");
  el.onclick = null;
  el.oncontextmenu = null;
  el.removeAttribute("aria-label");
}
