import type { ReprioritizationAction, ReprioritizationPolicy } from "./settings-data";

export type ReprioritizationTrigger =
  | "repeated-failure"
  | "early-success"
  | "article-completion"
  | "large-batch";

export interface ReprioritizationContext {
  consecutiveFailures?: number;
  successfulReviews?: number;
  articleCompleted?: boolean;
  batchSize?: number;
}

export function reprioritizationAction(
  trigger: ReprioritizationTrigger,
  policy: ReprioritizationPolicy,
  context: ReprioritizationContext,
  suppressed: ReadonlySet<ReprioritizationTrigger> = new Set(),
): ReprioritizationAction {
  if (suppressed.has(trigger)) return "off";
  switch (trigger) {
    case "repeated-failure":
      return (context.consecutiveFailures ?? 0) >= policy.repeatedFailureThreshold
        ? policy.repeatedFailure : "off";
    case "early-success":
      return (context.successfulReviews ?? Infinity) <= policy.earlySuccessCount
        ? policy.earlySuccess : "off";
    case "article-completion":
      return context.articleCompleted ? policy.articleCompletion : "off";
    case "large-batch":
      return (context.batchSize ?? 0) >= policy.largeBatchThreshold
        ? policy.largeBatch : "off";
  }
}
