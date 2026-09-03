/**
 * Status bar queue-load indicator (UI commitment #4: glanceable queue load).
 *
 * Surfaces three numbers without requiring a click: how many elements are due
 * now, how many are postponed (last due-change is mercy, due still future),
 * how many new elements landed in the last seven days. "Later today" stays
 * in the tooltip. Direct response to the SuperMemo Information Fatigue
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
   * Non-dismissed elements whose last due-changing event is
   * `mercy-postponed` and whose due is still in the future. Later-today
   * (topic-advanced) is not mercy and stays in `later`.
   */
  postponed: number;
  /**
   * Count of `element-created` events in the last seven days. Not net of
   * dismissals or deletions; this is "inflow," tracked as a leading
   * indicator that the user is importing faster than they can process.
   */
  inflow7d: number;
  /** `due` split by element type for the tooltip. */
  dueByType: { topic: number; extract: number; item: number };
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DUE_CHANGE_KINDS = new Set<IrEvent["kind"]>([
  "mercy-postponed",
  "graded",
  "topic-advanced",
]);

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

/** Last event that moved an element's due, per target. */
export function lastDueChangeKind(
  events: Iterable<IrEvent>,
): Map<string, IrEvent["kind"]> {
  const last = new Map<
    string,
    { lamport: number; ts: number; kind: IrEvent["kind"] }
  >();
  for (const ev of events) {
    if (!DUE_CHANGE_KINDS.has(ev.kind)) continue;
    const prev = last.get(ev.target);
    if (
      !prev ||
      ev.lamport > prev.lamport ||
      (ev.lamport === prev.lamport && ev.ts >= prev.ts)
    ) {
      last.set(ev.target, {
        lamport: ev.lamport,
        ts: ev.ts,
        kind: ev.kind,
      });
    }
  }
  const out = new Map<string, IrEvent["kind"]>();
  for (const [id, rec] of last) out.set(id, rec.kind);
  return out;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
}

/**
 * Human phrasing for the next due time, in the user's local day terms.
 *
 * Formats by hand rather than via `toLocaleString` so the output is
 * deterministic under test and identical on every install; the review pane
 * is not the place to discover that a device's ICU data is missing.
 */
export function describeNextDue(nextDueMs: number, now: number): string {
  const diff = nextDueMs - now;
  if (diff <= 0) return "now";
  if (diff < 60 * 1000) return "in under a minute";
  if (diff < 60 * 60 * 1000) {
    const mins = Math.round(diff / (60 * 1000));
    return `in ${mins} min`;
  }
  const then = new Date(nextDueMs);
  const endToday = endOfDayMs(now);
  const endTomorrow = endOfDayMs(endToday + 1);
  if (nextDueMs <= endToday) {
    const hours = Math.round(diff / (60 * 60 * 1000));
    return `today ${hhmm(then)} (in ${hours} h)`;
  }
  if (nextDueMs <= endTomorrow) return `tomorrow ${hhmm(then)}`;
  if (diff < 7 * DAY_MS) return `${WEEKDAYS[then.getDay()]} ${hhmm(then)}`;
  const days = Math.round(diff / DAY_MS);
  return `in ${days} days`;
}

/** What is coming, for the "nothing due right now" panel. */
export interface UpcomingLoad {
  /** Soonest future due time across non-dismissed elements, if any. */
  nextDueMs?: number;
  /** Due after end-of-today but on or before end-of-tomorrow. */
  dueTomorrow: number;
  /** Due after `now` and within seven days. */
  due7d: number;
}

/**
 * Forward-looking counts for the review pane's nothing-due state.
 *
 * Deliberately separate from `computeLoad`: that one answers "what is
 * waiting for me" for the always-on status bar, this one answers "when do I
 * come back" and only runs when a review start finds an empty queue. Pure
 * (elements + now in, counts out) so it tests without Obsidian.
 */
export function computeUpcoming(
  elements: Iterable<IrElement>,
  now: number,
): UpcomingLoad {
  const endToday = endOfDayMs(now);
  const endTomorrow = endOfDayMs(endToday + 1);
  const in7d = now + 7 * DAY_MS;
  let nextDueMs: number | undefined;
  let dueTomorrow = 0;
  let due7d = 0;
  for (const el of elements) {
    if (el.dismissed) continue;
    const d = dueOf(el);
    if (d === undefined || d <= now) continue;
    if (nextDueMs === undefined || d < nextDueMs) nextDueMs = d;
    if (d > endToday && d <= endTomorrow) dueTomorrow += 1;
    if (d <= in7d) due7d += 1;
  }
  return { nextDueMs, dueTomorrow, due7d };
}

export function computeLoad(
  elements: Iterable<IrElement>,
  events: Iterable<IrEvent>,
  now: number,
): QueueLoad {
  const endToday = endOfDayMs(now);
  const sevenDaysAgo = now - 7 * DAY_MS;
  const lastKind = lastDueChangeKind(events);
  let due = 0;
  let later = 0;
  let postponed = 0;
  const dueByType = { topic: 0, extract: 0, item: 0 };
  for (const el of elements) {
    if (el.dismissed) continue;
    const d = dueOf(el);
    if (d === undefined) continue;
    if (d <= now) {
      due += 1;
      dueByType[el.type] += 1;
    } else if (d <= endToday) {
      later += 1;
    }
    if (d > now && lastKind.get(el.id) === "mercy-postponed") {
      postponed += 1;
    }
  }
  let inflow7d = 0;
  for (const ev of events) {
    if (ev.kind === "element-created" && ev.ts >= sevenDaysAgo) inflow7d += 1;
  }
  return { due, later, postponed, inflow7d, dueByType };
}

/** Compact text form used for the aria-label and as a render fallback. */
export function formatLoad(load: QueueLoad): string {
  return (
    `${load.due} due  ·  ${load.postponed} postponed  ·  +${load.inflow7d}/7d`
  );
}

export function formatLoadTooltip(load: QueueLoad): string {
  return (
    `IR queue: ${load.due} due now ` +
    `(${load.dueByType.topic} topics, ${load.dueByType.extract} extracts, ` +
    `${load.dueByType.item} items), ${load.later} later today, ` +
    `${load.postponed} postponed, ${load.inflow7d} added in last 7 days. ` +
    `Click to start review. Right-click for tree, neural, and other IR actions.`
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
  el.createSpan({
    cls: "ir-status-bar-postponed",
    text: `${load.postponed} postponed`,
  });
  el.createSpan({ cls: "ir-status-bar-sep", text: " · " });
  el.createSpan({
    cls: "ir-status-bar-inflow",
    text: `+${load.inflow7d}/7d`,
  });

  el.setAttribute("aria-label", formatLoadTooltip(load));

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
