import type { ElementId } from "./ids";
import { clampPriority, type IrElement } from "./model";

export interface PriorityPlacement {
  requestedPriority: number;
  beforeId?: ElementId;
  afterId?: ElementId;
}

export interface PriorityPlacementIntent extends PriorityPlacement {
  targetId: ElementId;
}

export interface PriorityPlacementPreview {
  intent: PriorityPlacementIntent;
  finalPosition: number;
  total: number;
  beforeId?: ElementId;
  afterId?: ElementId;
  projectedPriority: number;
}

export interface PriorityBatchPlan {
  initialOrder: ElementId[];
  finalOrder: ElementId[];
  intents: PriorityPlacementIntent[];
  selectedIds: ElementId[];
}

/**
 * Baseline collection order before replaying `priority-set` placements in
 * `fold()`: lower `priority` first; ties → newer `created` first; then id.
 */
export function collectionSortOrder(elements: Iterable<IrElement>): ElementId[] {
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

export function positionForPriority(priority: number, total: number): number {
  return insertionIndexForPriority(priority, Math.max(1, total)) + 1;
}

export function priorityForPosition(position: number, total: number): number {
  if (total <= 1) return 0;
  const index = Math.min(total - 1, Math.max(0, Math.round(position) - 1));
  return index * 100 / (total - 1);
}

export function buildPositionPlacement(
  elements: Iterable<IrElement>,
  targetId: ElementId,
  position: number,
): PriorityPlacement {
  const total = [...elements].length;
  return buildPriorityPlacement(elements, targetId, priorityForPosition(position, total));
}

export function previewPriorityPlacement(
  elements: Iterable<IrElement>,
  targetId: ElementId,
  requestedPriority: number,
): PriorityPlacementPreview {
  const all = [...elements];
  const placement = buildPriorityPlacement(all, targetId, requestedPriority);
  const initialOrder = collectionSortOrder(all);
  const finalOrder = applyPriorityPlacement(initialOrder, targetId, placement);
  const index = finalOrder.indexOf(targetId);
  const total = finalOrder.length;
  return {
    intent: { targetId, ...placement },
    finalPosition: index + 1,
    total,
    beforeId: index + 1 < total ? finalOrder[index + 1] : undefined,
    afterId: index > 0 ? finalOrder[index - 1] : undefined,
    projectedPriority: priorityForPosition(index + 1, total),
  };
}

export function buildPriorityPlacement(
  elements: Iterable<IrElement>,
  targetId: ElementId,
  requestedPriority: number,
): PriorityPlacement {
  const order = collectionSortOrder(elements).filter((id) => id !== targetId);
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

function stableSelection(
  order: readonly ElementId[],
  selected: Iterable<ElementId>,
): ElementId[] {
  const selectedSet = new Set(selected);
  return order.filter((value) => selectedSet.has(value));
}

function placementAtIndex(
  orderWithoutTarget: readonly ElementId[],
  targetId: ElementId,
  index: number,
): PriorityPlacementIntent {
  const clamped = Math.min(orderWithoutTarget.length, Math.max(0, index));
  const total = orderWithoutTarget.length + 1;
  return {
    targetId,
    requestedPriority: priorityForPosition(clamped + 1, total),
    beforeId: orderWithoutTarget[clamped],
    afterId: clamped > 0 ? orderWithoutTarget[clamped - 1] : undefined,
  };
}

function planFinalOrder(
  initialOrder: readonly ElementId[],
  selectedIds: readonly ElementId[],
  finalOrder: readonly ElementId[],
): PriorityBatchPlan {
  let working = [...initialOrder];
  const intents: PriorityPlacementIntent[] = [];
  for (const targetId of selectedIds) {
    const desiredIndex = finalOrder.indexOf(targetId);
    if (desiredIndex < 0) continue;
    const without = working.filter((id) => id !== targetId);
    const preceding = finalOrder.slice(0, desiredIndex).filter((id) => id !== targetId);
    let index = 0;
    for (const id of preceding) {
      const candidate = without.indexOf(id);
      if (candidate >= index) index = candidate + 1;
    }
    const intent = placementAtIndex(without, targetId, index);
    intents.push(intent);
    working = applyPriorityPlacement(working, targetId, intent);
  }
  return {
    initialOrder: [...initialOrder],
    finalOrder: [...finalOrder],
    intents,
    selectedIds: [...selectedIds],
  };
}

export function planBlockInsertion(
  initialOrder: readonly ElementId[],
  selected: Iterable<ElementId>,
  position: number,
): PriorityBatchPlan {
  const selectedIds = stableSelection(initialOrder, selected);
  const selectedSet = new Set(selectedIds);
  const remaining = initialOrder.filter((id) => !selectedSet.has(id));
  const index = Math.min(remaining.length, Math.max(0, Math.round(position) - 1));
  const finalOrder = [...remaining.slice(0, index), ...selectedIds, ...remaining.slice(index)];
  return planFinalOrder(initialOrder, selectedIds, finalOrder);
}

export function planAdjacentBlockMove(
  initialOrder: readonly ElementId[],
  selected: Iterable<ElementId>,
  direction: -1 | 1,
): PriorityBatchPlan {
  const selectedIds = stableSelection(initialOrder, selected);
  if (selectedIds.length === 0) return planFinalOrder(initialOrder, [], initialOrder);
  const selectedSet = new Set(selectedIds);
  const remaining = initialOrder.filter((id) => !selectedSet.has(id));
  const first = initialOrder.indexOf(selectedIds[0]);
  const before = initialOrder.slice(0, first).filter((id) => !selectedSet.has(id)).length;
  return planBlockInsertion(initialOrder, selectedIds, before + 1 + direction);
}

export function planMultiplierChange(
  initialOrder: readonly ElementId[],
  selected: Iterable<ElementId>,
  multiplier: number,
): PriorityBatchPlan {
  const selectedIds = stableSelection(initialOrder, selected);
  let finalOrder = [...initialOrder];
  for (const targetId of selectedIds) {
    const current = finalOrder.indexOf(targetId);
    const currentPriority = priorityForPosition(current + 1, finalOrder.length);
    const without = finalOrder.filter((id) => id !== targetId);
    const targetIndex = insertionIndexForPriority(currentPriority * multiplier, finalOrder.length);
    without.splice(targetIndex, 0, targetId);
    finalOrder = without;
  }
  return planFinalOrder(initialOrder, selectedIds, finalOrder);
}

export function planSpread(
  initialOrder: readonly ElementId[],
  selected: Iterable<ElementId>,
  startPriority: number,
  endPriority: number,
): PriorityBatchPlan {
  return planPriorityTargets(initialOrder, selected, (index, count) =>
    count <= 1
      ? clampPriority(startPriority)
      : clampPriority(startPriority) + index *
        (clampPriority(endPriority) - clampPriority(startPriority)) / (count - 1));
}

export function planAdjust(
  initialOrder: readonly ElementId[],
  selected: Iterable<ElementId>,
  startPriority: number,
  endPriority: number,
): PriorityBatchPlan {
  const selectedIds = stableSelection(initialOrder, selected);
  const original = selectedIds.map((id) =>
    priorityForPosition(initialOrder.indexOf(id) + 1, initialOrder.length));
  const min = original[0] ?? 0;
  const max = original[original.length - 1] ?? min;
  return planPriorityTargets(initialOrder, selectedIds, (index) => {
    const ratio = max === min ? (selectedIds.length <= 1 ? 0 : index / (selectedIds.length - 1))
      : (original[index] - min) / (max - min);
    return clampPriority(startPriority) + ratio *
      (clampPriority(endPriority) - clampPriority(startPriority));
  });
}

function planPriorityTargets(
  initialOrder: readonly ElementId[],
  selected: Iterable<ElementId>,
  target: (index: number, count: number) => number,
): PriorityBatchPlan {
  const selectedIds = stableSelection(initialOrder, selected);
  let finalOrder = [...initialOrder];
  for (let index = 0; index < selectedIds.length; index += 1) {
    const targetId = selectedIds[index];
    const without = finalOrder.filter((id) => id !== targetId);
    without.splice(insertionIndexForPriority(target(index, selectedIds.length), finalOrder.length), 0, targetId);
    finalOrder = without;
  }
  return planFinalOrder(initialOrder, selectedIds, finalOrder);
}

export function formatPriority(priority: number): string {
  return clampPriority(priority).toFixed(4).replace(/\.?0+$/, "");
}
