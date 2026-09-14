/**
 * Optimizer stage 1 (PLAN-OPTIMIZER.md §1): turn the event log into a
 * clean training revlog — per-card rating sequences — plus an exclusion
 * report that counts every dropped review and says why. The report is the
 * feature: this optimizer fails loudly where others discard silently.
 *
 * Pure: no Obsidian imports, no I/O. Callers pass the full event stream
 * from `IrStore.loadEvents()` and a folded `LogState`.
 */

import type { ElementId, EventId } from "../ids";
import { undoneEventIds, type LogState } from "../log";
import type { IrEvent } from "../model";

export interface Review {
  /** Wall-clock epoch ms of the review (event `ts`). */
  ts: number;
  /** FSRS rating: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: 1 | 2 | 3 | 4;
  /** True when the user took the SM-2 interval in the divergence picker. */
  overridden: boolean;
}

export interface RevlogCard {
  elementId: ElementId;
  /** Fold order (lamport, then event id), oldest first. */
  reviews: Review[];
}

/**
 * Reasons a review (or, for `shortCard`, a whole card) is excluded from
 * training. Keys are stable identifiers; values are the user-facing labels
 * the report and (later) the stats panel print.
 */
export const EXCLUSION_LABELS = {
  noRating: "No rating recorded",
  undone: "Review undone",
  missingElement: "Element deleted",
  duplicate: "Duplicate event",
  shortCard: "Cards with under 2 reviews",
} as const;

export type ExclusionReason = keyof typeof EXCLUSION_LABELS;

export interface ExclusionReport {
  /**
   * One row per reason, in the order rules are applied. `noRating`,
   * `undone`, `missingElement` and `duplicate` count reviews; `shortCard`
   * counts cards (its reviews were otherwise usable, the card is just too
   * short to inform the fit).
   */
  rows: { reason: ExclusionReason; count: number }[];
  includedReviews: number;
  includedCards: number;
  /** Included reviews whose interval came from a divergence-picker override. */
  overriddenIncluded: number;
}

export interface Revlog {
  cards: RevlogCard[];
  report: ExclusionReport;
}

const REASON_ORDER: ExclusionReason[] = [
  "noRating",
  "undone",
  "missingElement",
  "duplicate",
  "shortCard",
];

export function extractRevlog(events: IrEvent[], state: LogState): Revlog {
  const counts: Record<ExclusionReason, number> = {
    noRating: 0,
    undone: 0,
    missingElement: 0,
    duplicate: 0,
    shortCard: 0,
  };
  const undone = undoneEventIds(events);

  // Same total order as the fold, so replayed sequences match what the
  // scheduler actually experienced.
  const sorted = [...events].sort((a, b) => {
    if (a.lamport !== b.lamport) return a.lamport - b.lamport;
    return a.id.localeCompare(b.id);
  });

  const seen = new Set<EventId>();
  const byCard = new Map<ElementId, Review[]>();
  let overriddenIncluded = 0;

  for (const ev of sorted) {
    if (ev.kind !== "graded") continue;

    const g = (ev.payload as { grade?: unknown }).grade;
    if (g !== 1 && g !== 2 && g !== 3 && g !== 4) {
      counts.noRating++;
      continue;
    }
    if (undone.has(ev.id)) {
      counts.undone++;
      continue;
    }
    if (!state.elements.has(ev.target)) {
      counts.missingElement++;
      continue;
    }
    if (seen.has(ev.id)) {
      counts.duplicate++;
      continue;
    }
    seen.add(ev.id);

    const overridden =
      (ev.payload as { overridden?: unknown }).overridden === true;
    if (overridden) overriddenIncluded++;

    const list = byCard.get(ev.target);
    const review: Review = { ts: ev.ts, rating: g, overridden };
    if (list) list.push(review);
    else byCard.set(ev.target, [review]);
  }

  const cards: RevlogCard[] = [];
  let includedReviews = 0;
  for (const [elementId, reviews] of byCard) {
    if (reviews.length < 2) {
      counts.shortCard++;
      // Its reviews leave the included pool too, including override marks.
      overriddenIncluded -= reviews.filter((r) => r.overridden).length;
      continue;
    }
    cards.push({ elementId, reviews });
    includedReviews += reviews.length;
  }

  return {
    cards,
    report: {
      rows: REASON_ORDER.map((reason) => ({ reason, count: counts[reason] })),
      includedReviews,
      includedCards: cards.length,
      overriddenIncluded,
    },
  };
}

/**
 * What a fit run could do with this data, mirroring the fsrs-rs tiers
 * (PLAN-OPTIMIZER.md §3). Pure statement of capability; the fit itself
 * lands in stage 2.
 */
export function fitTier(report: ExclusionReport): {
  tier: "none" | "pretrain" | "full";
  lowData: boolean;
} {
  const tier =
    report.includedCards < 8
      ? "none"
      : report.includedCards < 64
        ? "pretrain"
        : "full";
  return { tier, lowData: report.includedReviews < 400 };
}

const TIER_TEXT: Record<"none" | "pretrain" | "full", string> = {
  none: "none (needs 8+ cards)",
  pretrain: "initial stability only (full fit needs 64+ cards)",
  full: "full 21-parameter fit",
};

/**
 * The clipboard report behind "Copy optimizer data report". Data only;
 * background (why reviews lack ratings, what the tiers mean) lives in the
 * docs, not here. Deterministic for a given revlog + date.
 */
export function formatDataReport(revlog: Revlog, now: number): string {
  const { report } = revlog;
  const { tier, lowData } = fitTier(report);

  const lines: string[] = [
    "# Optimizer data report",
    "",
    "| | |",
    "|---|---|",
    `| Date | ${new Date(now).toISOString().slice(0, 10)} |`,
    `| Usable reviews | ${report.includedReviews} |`,
    `| Cards | ${report.includedCards} |`,
    `| Fit possible | ${TIER_TEXT[tier]} |`,
  ];
  if (tier !== "none") {
    lines.push(
      `| Confidence | ${lowData ? "low (under 400 reviews)" : "normal"} |`,
    );
  }

  const nonZero = report.rows.filter((r) => r.count > 0);
  lines.push("", "## Excluded", "");
  if (nonZero.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Reason | Count |", "|---|---|");
    for (const row of nonZero) {
      lines.push(`| ${EXCLUSION_LABELS[row.reason]} | ${row.count} |`);
    }
  }

  return lines.join("\n") + "\n";
}
