/**
 * Pure mobile review logic. No Obsidian imports so unit tests run under
 * Node's test runner.
 */

export type MobileReviewLayout = "full" | "minimal";
export type MobileReviewButtons = "compact" | "comfortable";

export interface MobileReviewConfig {
  layout: MobileReviewLayout;
  fontSize: number;
  buttons: MobileReviewButtons;
}

/**
 * Build the grade button labels for mobile. Compact mode uses shorter labels.
 */
export function mobileGradeLabels(compact: boolean): {
  again: string;
  hard: string;
  good: string;
  easy: string;
} {
  if (compact) {
    return { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
  }
  return { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
}
