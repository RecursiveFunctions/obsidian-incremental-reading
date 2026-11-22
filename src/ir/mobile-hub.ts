/**
 * Mobile discovery helpers. After 0.6.1 the phone lost every obvious IR
 * entry: no status bar, one ribbon icon behind a swipe, FAB hidden on the
 * file explorer, and a hub that only listed extract/cloze when a selection
 * existed. Session actions on the ring stay small: Start review and the
 * element tree are always there (including during an open session, so the
 * FAB can still start today's due queue). Go neural only when the current
 * thing is already in IR — during review that is the card; otherwise the
 * open note. A singleton walk off a just-imported note is not useful.
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
  if (ctx.inReview) return ["start-review", "open-tree", "go-neural"];
  const out: SessionHubKind[] = ["start-review", "open-tree"];
  if (ctx.alreadyIr) out.push("go-neural");
  if (ctx.hasMarkdownFile && !ctx.alreadyIr) out.push("mark-topic");
  return out;
}

/**
 * Workspace FAB shows on mobile when enabled and outside active Review (#65).
 * Default optional arguments preserve backward-compatible `irWorkspaceFabShouldShow(true)` calls.
 */
export function irWorkspaceFabShouldShow(
  isMobile: boolean,
  inActiveReview = false,
  settingEnabled = true,
): boolean {
  return isMobile && settingEnabled && !inActiveReview;
}

/**
 * Auxiliary mobile overlays (Mobile Shell, Capture FAB, Review FAB) yield
 * while the dedicated Review leaf is active so they never cover `.ir-review-dock`.
 */
export function mobileAuxiliaryChromeShouldShow(
  settingEnabled: boolean,
  inActiveReview: boolean,
): boolean {
  return settingEnabled && !inActiveReview;
}
