/**
 * Pure gesture-to-action-plan controller for the element tree view.
 * 
 * This module provides a pure function that maps user gestures on tree
 * elements to concrete actions that can be executed by the tree view.
 * 
 * No I/O, no Obsidian API, no Date.now, no random. Pure functions only.
 */

import type { IrElement } from "./model";
import type { ElementId } from "./ids";

/**
 * User gestures that can be applied to tree elements.
 */
export type TreeGesture =
  | { kind: "set-priority"; value: number }
  | { kind: "toggle-dismiss" }
  | { kind: "postpone"; days: number }
  | { kind: "open" };

/**
 * Concrete actions that can be executed by the tree view.
 */
export type TreeAction =
  | { kind: "set-priority"; elementId: ElementId; priority: number }
  | { kind: "toggle-dismiss"; elementId: ElementId; dismissed: boolean }
  | { kind: "postpone"; elementId: ElementId; days: number }
  | { kind: "open-note"; notePath: string }
  | { kind: "noop"; reason: string };

/**
 * Input to the planTreeAction function.
 */
export interface PlanTreeActionInput {
  gesture: TreeGesture;
  element: IrElement;
  now: number;
}

/**
 * Maps a user gesture on a tree element to a concrete action.
 * 
 * Rules:
 * 1. set-priority: Clamp value to [0, 100] if finite, else noop
 * 2. toggle-dismiss: Always toggle the dismissed state
 * 3. postpone: Floor days to integer, if < 1 then noop
 * 4. open: Open note if notePath exists, else noop
 * 5. Determinism: Identical inputs yield deep-equal plans
 * 6. Purity: Inputs are never mutated
 * 7. Total: Never throws on valid input
 */
export function planTreeAction(input: PlanTreeActionInput): TreeAction {
  const { gesture, element, now } = input;

  switch (gesture.kind) {
    case "set-priority": {
      const value = gesture.value;
      if (!Number.isFinite(value)) {
        return { kind: "noop", reason: "priority value is not finite" };
      }
      const clamped = Math.min(100, Math.max(0, value));
      return { kind: "set-priority", elementId: element.id, priority: clamped };
    }

    case "toggle-dismiss": {
      return { kind: "toggle-dismiss", elementId: element.id, dismissed: !element.dismissed };
    }

    case "postpone": {
      const floored = Math.floor(gesture.days);
      if (floored < 1) {
        return { kind: "noop", reason: "postpone days must be at least 1" };
      }
      return { kind: "postpone", elementId: element.id, days: floored };
    }

    case "open": {
      if (element.notePath && element.notePath.length > 0) {
        return { kind: "open-note", notePath: element.notePath };
      }
      return { kind: "noop", reason: "no note path" };
    }
  }
}