/**
 * Escape in IR review is layered: leave edit before leaving the session.
 */

export type EscapeReviewAction =
  | { kind: "detach" }
  | { kind: "exit-edit" }
  | { kind: "end-neural" };

export function escapeReviewAction(state: {
  sessionComplete: boolean;
  emptyVault: boolean;
  editing: boolean;
  isNeural: boolean;
}): EscapeReviewAction {
  if (state.sessionComplete || state.emptyVault) return { kind: "detach" };
  if (state.editing) return { kind: "exit-edit" };
  if (state.isNeural) return { kind: "end-neural" };
  return { kind: "detach" };
}
