/**
 * Pure touch selection snapshot & multi-span hold controller (#65).
 * Buffers validated DOM ranges across WebKit's 0–350 ms `pointerdown`
 * selection-collapse window and enforces single-surface multi-span holds.
 */

import type { ElementId } from "./ids";

export type SelectionSurface = "main" | "context";

export const SELECTION_COLLAPSE_GRACE_MS = 350;

export interface TouchSelectionSnapshot {
  slotId: ElementId;
  surface: SelectionSurface;
  text: string;
  offsets: { start: number; end: number } | null;
  sourcePath?: string | null;
  parentId?: ElementId | null;
  capturedAtMs: number;
}

export interface HeldTouchSpan {
  text: string;
  start: number;
  end: number;
}

export class TouchSelectionModel {
  private snapshot: TouchSelectionSnapshot | null = null;
  private heldSlotId: ElementId | null = null;
  private heldSurface: SelectionSurface | null = null;
  private heldSourcePath: string | null = null;
  private heldParentId: ElementId | null = null;
  private readonly heldSpans: HeldTouchSpan[] = [];

  updateLiveSelection(next: TouchSelectionSnapshot): void {
    if (!next.text.trim()) return;
    if (this.heldSlotId && this.heldSlotId !== next.slotId) {
      this.clearHeld();
    }
    this.snapshot = next;
  }

  /**
   * Called when `selectionchange` sees an empty/collapsed selection.
   * Keeps `snapshot` alive so a button click within `SELECTION_COLLAPSE_GRACE_MS`
   * can still consume it, while `hasVisibleBar` hides after the grace window.
   */
  notifySelectionCollapsed(nowMs: number): void {
    if (
      this.snapshot &&
      nowMs - this.snapshot.capturedAtMs > SELECTION_COLLAPSE_GRACE_MS
    ) {
      this.snapshot = null;
    }
  }

  getActiveSnapshot(slotId: ElementId, nowMs: number): TouchSelectionSnapshot | null {
    if (!this.snapshot || this.snapshot.slotId !== slotId) return null;
    if (nowMs - this.snapshot.capturedAtMs > SELECTION_COLLAPSE_GRACE_MS * 20) {
      // Stale snapshot from a much older selection that was already dismissed
      return this.snapshot;
    }
    return this.snapshot;
  }

  /**
   * Resolve a snapshot for an immediate toolbar tap (`Extract`, `Cloze`, `+ Hold`),
   * honoring the `350 ms` WebKit collapse grace window when `liveCollapsed` is true.
   */
  resolveForAction(
    slotId: ElementId,
    nowMs: number,
    liveCollapsed: boolean,
  ): TouchSelectionSnapshot | null {
    if (!this.snapshot || this.snapshot.slotId !== slotId) return null;
    if (
      liveCollapsed &&
      nowMs - this.snapshot.capturedAtMs > SELECTION_COLLAPSE_GRACE_MS
    ) {
      this.snapshot = null;
      return null;
    }
    return this.snapshot;
  }

  clearSnapshot(): void {
    this.snapshot = null;
  }

  resetForSlot(slotId: ElementId | null): void {
    if (!slotId || this.snapshot?.slotId !== slotId) {
      this.snapshot = null;
    }
    if (!slotId || this.heldSlotId !== slotId) {
      this.clearHeld();
    }
  }

  clearAll(): void {
    this.snapshot = null;
    this.clearHeld();
  }

  clearHeld(): void {
    this.heldSlotId = null;
    this.heldSurface = null;
    this.heldSourcePath = null;
    this.heldParentId = null;
    this.heldSpans.length = 0;
  }

  getHeldCount(slotId: ElementId): number {
    return this.heldSlotId === slotId ? this.heldSpans.length : 0;
  }

  getHeldSurface(slotId: ElementId): SelectionSurface | null {
    return this.heldSlotId === slotId ? this.heldSurface : null;
  }

  getHeldContextMeta(slotId: ElementId): {
    surface: SelectionSurface | null;
    sourcePath: string | null;
    parentId: ElementId | null;
    spans: readonly HeldTouchSpan[];
  } {
    if (this.heldSlotId !== slotId) {
      return { surface: null, sourcePath: null, parentId: null, spans: [] };
    }
    return {
      surface: this.heldSurface,
      sourcePath: this.heldSourcePath,
      parentId: this.heldParentId,
      spans: [...this.heldSpans],
    };
  }

  canHoldSnapshot(snap: TouchSelectionSnapshot | null): {
    ok: boolean;
    reason?: string;
  } {
    if (!snap || !snap.offsets) {
      return { ok: false, reason: "Select contiguous prose to hold." };
    }
    if (
      this.heldSlotId === snap.slotId &&
      this.heldSurface !== null &&
      this.heldSurface !== snap.surface
    ) {
      return {
        ok: false,
        reason: "Finish or clear held spans on the other pane first.",
      };
    }
    return { ok: true };
  }

  holdSnapshot(snap: TouchSelectionSnapshot): boolean {
    const check = this.canHoldSnapshot(snap);
    if (!check.ok || !snap.offsets) return false;
    if (this.heldSlotId !== snap.slotId) {
      this.clearHeld();
      this.heldSlotId = snap.slotId;
    }
    this.heldSurface = snap.surface;
    this.heldSourcePath = snap.sourcePath ?? null;
    this.heldParentId = snap.parentId ?? null;
    const { start, end } = snap.offsets;
    const duplicate = this.heldSpans.some((s) => s.start === start && s.end === end);
    if (!duplicate) {
      this.heldSpans.push({ text: snap.text, start, end });
      this.heldSpans.sort((a, b) => a.start - b.start || a.end - b.end);
    }
    this.snapshot = null;
    return true;
  }
}
