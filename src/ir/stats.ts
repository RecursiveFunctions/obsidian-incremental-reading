import type { IrElement } from "./model";

/** grade: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export interface GradeEvent {
  ts: number;
  grade: number;
}

export interface Stats {
  total: number;
  reviewsInWindow: number;
  retention: number;
  queueSize: number;
  dueCount: number;
}

export function computeStats(
  elements: IrElement[],
  grades: GradeEvent[],
  now: number,
  windowStartMs: number,
): Stats {
  const total = elements.length;

  let queueSize = 0;
  let dueCount = 0;

  for (const el of elements) {
    if (el.dismissed) continue;

    if (el.card || el.schedule) {
      queueSize += 1;
    }

    if (
      (el.card && el.card.due <= now) ||
      (el.schedule && el.schedule.due <= now)
    ) {
      dueCount += 1;
    }
  }

  let reviewsInWindow = 0;
  let recalled = 0;
  for (const g of grades) {
    if (g.ts >= windowStartMs && g.ts <= now) {
      reviewsInWindow += 1;
      if (g.grade >= 2) {
        recalled += 1;
      }
    }
  }

  const retention =
    reviewsInWindow === 0
      ? 0
      : Math.round((recalled / reviewsInWindow) * 1e4) / 1e4;

  return {
    total,
    reviewsInWindow,
    retention,
    queueSize,
    dueCount,
  };
}
