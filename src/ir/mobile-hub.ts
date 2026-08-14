/**
 * Mobile discovery helpers. After 0.6.1 the phone lost every obvious IR
 * entry: no status bar, one ribbon icon behind a swipe, FAB hidden on the
 * file explorer, and a hub that only listed extract/cloze when a selection
 * existed. Session actions on the ring stay small: Start review and the
 * element tree are always there; Go neural only when the current thing is
 * already in IR (a singleton walk off a just-imported note is not useful).
 */

export type SessionHubKind =
  | "start-review"
  | "open-tree"
  | "go-neural"
  | "mark-topic";

export function sessionHubKinds(ctx: {
  inReview: boolean;
  hasMarkdownFile: boolean;
  alreadyIr: boolean;
}): SessionHubKind[] {
  if (ctx.inReview) return ["open-tree", "go-neural"];
  const out: SessionHubKind[] = ["start-review", "open-tree"];
  if (ctx.alreadyIr) out.push("go-neural");
  if (ctx.hasMarkdownFile && !ctx.alreadyIr) out.push("mark-topic");
  return out;
}

/** Workspace FAB is always on while the plugin is loaded on mobile. */
export function irWorkspaceFabShouldShow(isMobile: boolean): boolean {
  return isMobile;
}
