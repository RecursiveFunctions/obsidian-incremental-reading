import { clampPriority } from "./model";

export const PRIORITY_SCHEDULING_POLICY_VERSION = 1;

export function interpolatePriorityEndpoint(
  priority: number,
  highPriorityValue: number,
  lowPriorityValue: number,
): number {
  const ratio = clampPriority(priority) / 100;
  return highPriorityValue + (lowPriorityValue - highPriorityValue) * ratio;
}

export function effectiveItemRetention(
  priority: number,
  enabled: boolean,
  fallback: number,
  highPriorityRetention: number,
  lowPriorityRetention: number,
): number {
  const value = enabled
    ? interpolatePriorityEndpoint(priority, highPriorityRetention, lowPriorityRetention)
    : fallback;
  return Math.min(0.99, Math.max(0.7, value));
}

export function effectiveReadingAFactor(
  priority: number,
  enabled: boolean,
  baseAFactor: number,
  highPriorityAFactor: number,
  lowPriorityAFactor: number,
): number {
  const value = enabled
    ? interpolatePriorityEndpoint(priority, highPriorityAFactor, lowPriorityAFactor)
    : baseAFactor;
  return Math.max(1.1, value);
}
