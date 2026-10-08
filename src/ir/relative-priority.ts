import type { ElementId } from "./ids";
import { clampPriority, type IrElement } from "./model";

export interface PriorityPlacement {
  requestedPriority: number;
  beforeId?: ElementId;
  afterId?: ElementId;
}

export function legacyPriorityOrder(elements: Iterable<IrElement>): ElementId[] {
  return [...elements]
    .sort((a, b) =>
      a.priority - b.priority ||
      b.created - a.created ||
      a.id.localeCompare(b.id),
    )
    .map((element) => element.id);
}

export function insertionIndexForPriority(priority: number, finalSize: number): number {
  if (finalSize <= 1) return 0;
  return Math.floor(clampPriority(priority) / 100 * (finalSize - 1));
}

export function buildPriorityPlacement(
  elements: Iterable<IrElement>,
  targetId: ElementId,
  requestedPriority: number,
): PriorityPlacement {
  const order = legacyPriorityOrder(elements).filter((id) => id !== targetId);
  const index = insertionIndexForPriority(requestedPriority, order.length + 1);
  return {
    requestedPriority: clampPriority(requestedPriority),
    beforeId: order[index],
    afterId: index > 0 ? order[index - 1] : undefined,
  };
}

export function applyPriorityPlacement(
  currentOrder: readonly ElementId[],
  targetId: ElementId,
  placement: PriorityPlacement,
): ElementId[] {
  const order = currentOrder.filter((id) => id !== targetId);
  const beforeIndex = placement.beforeId === undefined
    ? -1
    : order.indexOf(placement.beforeId);
  const afterIndex = placement.afterId === undefined
    ? -1
    : order.indexOf(placement.afterId);
  let index: number;

  if (beforeIndex >= 0 && afterIndex >= 0 && afterIndex < beforeIndex) {
    index = afterIndex + 1;
  } else if (beforeIndex >= 0) {
    index = beforeIndex;
  } else if (afterIndex >= 0) {
    index = afterIndex + 1;
  } else {
    index = insertionIndexForPriority(placement.requestedPriority, order.length + 1);
  }

  order.splice(index, 0, targetId);
  return order;
}

export function projectRelativePriorities(
  order: readonly ElementId[],
): Map<ElementId, number> {
  const priorities = new Map<ElementId, number>();
  const denominator = order.length - 1;
  for (let index = 0; index < order.length; index += 1) {
    priorities.set(order[index], denominator <= 0 ? 0 : index * 100 / denominator);
  }
  return priorities;
}

export function formatPriority(priority: number): string {
  return clampPriority(priority).toFixed(4).replace(/\.?0+$/, "");
}
