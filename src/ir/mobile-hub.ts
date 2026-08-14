/**
 * Mobile discovery helpers. After 0.6.1 the phone lost every obvious IR
 * entry: no status bar, one ribbon icon behind a swipe, FAB hidden on the
 * file explorer, and a hub that only listed extract/cloze when a selection
 * existed. These predicates keep Start review on the ring even with no
 * note open.
 */

export type SessionHubKind = "start-review" | "go-neural" | "mark-topic";

export function sessionHubKinds(ctx: {
  inReview: boolean;
  hasMarkdownFile: boolean;
  alreadyIr: boolean;
}): SessionHubKind[] {
  if (ctx.inReview) return [];
  const out: SessionHubKind[] = ["start-review", "go-neural"];
  if (ctx.hasMarkdownFile && !ctx.alreadyIr) out.push("mark-topic");
  return out;
}

/** Workspace FAB is always on while the plugin is loaded on mobile. */
export function irWorkspaceFabShouldShow(isMobile: boolean): boolean {
  return isMobile;
}
