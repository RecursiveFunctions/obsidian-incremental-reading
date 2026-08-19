/**
 * Review-pane Spacebar policy. Reading cards keep Space = Next.
 * Cloze cards: first Space reveals; after reveal, Space grades the
 * configured rating (default Good, SuperMemo/Anki muscle memory).
 */

import type { Grade } from "../fsrs";

export type SpaceAfterReveal = Grade | "off";

export const SPACE_AFTER_REVEAL_OPTIONS: ReadonlyArray<{
  value: SpaceAfterReveal;
  label: string;
}> = [
  { value: "good", label: "Good (3)" },
  { value: "easy", label: "Easy (4)" },
  { value: "hard", label: "Hard (2)" },
  { value: "again", label: "Again (1)" },
  { value: "off", label: "Do nothing (reveal only)" },
];

export function isSpaceAfterReveal(v: unknown): v is SpaceAfterReveal {
  return (
    v === "again" ||
    v === "hard" ||
    v === "good" ||
    v === "easy" ||
    v === "off"
  );
}

export type SpacebarReviewAction =
  | { kind: "next" }
  | { kind: "reveal" }
  | { kind: "grade"; grade: Grade }
  | { kind: "none" };

export function spacebarReviewAction(opts: {
  isReading: boolean;
  revealed: boolean;
  typing: boolean;
  spaceAfterReveal: SpaceAfterReveal;
}): SpacebarReviewAction {
  if (opts.typing) return { kind: "none" };
  if (opts.isReading) return { kind: "next" };
  if (!opts.revealed) return { kind: "reveal" };
  if (opts.spaceAfterReveal === "off") return { kind: "none" };
  return { kind: "grade", grade: opts.spaceAfterReveal };
}
