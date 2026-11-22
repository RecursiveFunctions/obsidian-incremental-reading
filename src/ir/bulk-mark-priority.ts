/**
 * Pure priority planning for bulk mark-as-topic (#90).
 * Placement requests only — finalizeFold projects final queue positions.
 */

import { clampPriority, PRIORITY_MAX, PRIORITY_MIN } from "./model";
import { formatPriority } from "./relative-priority";
import {
  folderTopicCandidates,
  type FolderFileRef,
} from "./folder-topics";

export type BulkPriorityMode =
  | { kind: "default" }
  | { kind: "fixed"; value: number }
  | { kind: "range"; min: number; max: number };

export type BulkPriorityPlan =
  | { ok: true; priorities: number[] }
  | { ok: false; reason: string };

/** Four-decimal priority format needs a band wide enough for N distinct slots. */
const PRIORITY_STEP = 0.0001;

export function evenSpacedPriorities(
  count: number,
  startPriority: number,
  endPriority: number,
): number[] {
  if (count <= 0) return [];
  const start = clampPriority(startPriority);
  const end = clampPriority(endPriority);
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) =>
    clampPriority(start + (index * (end - start)) / (count - 1)),
  );
}

export function planBulkMarkPriorities(
  count: number,
  mode: BulkPriorityMode,
  defaultPriority: number,
): BulkPriorityPlan {
  if (count <= 0) return { ok: true, priorities: [] };

  if (mode.kind === "default") {
    const p = clampPriority(defaultPriority);
    return { ok: true, priorities: Array.from({ length: count }, () => p) };
  }

  if (mode.kind === "fixed") {
    if (!Number.isFinite(mode.value)) {
      return { ok: false, reason: "Priority must be a finite number." };
    }
    const p = clampPriority(mode.value);
    return { ok: true, priorities: Array.from({ length: count }, () => p) };
  }

  if (!Number.isFinite(mode.min) || !Number.isFinite(mode.max)) {
    return { ok: false, reason: "Range bounds must be finite numbers." };
  }
  const min = clampPriority(mode.min);
  const max = clampPriority(mode.max);
  if (min > max) {
    return { ok: false, reason: "Range minimum must be ≤ maximum." };
  }
  if (count > 1) {
    const span = max - min;
    const needed = (count - 1) * PRIORITY_STEP;
    if (span + 1e-12 < needed) {
      return {
        ok: false,
        reason:
          `Range ${formatPriority(min)}–${formatPriority(max)} is too narrow ` +
          `for ${count} items (need ≥ ${formatPriority(needed)} span).`,
      };
    }
  }
  return { ok: true, priorities: evenSpacedPriorities(count, min, max) };
}

export interface BulkMarkSource {
  path: string;
  kind: "file" | "folder";
}

/**
 * Classify an Obsidian abstract file without relying on minified class names.
 * Folders expose `children`; files expose `extension`.
 */
export function classifyVaultEntry(entry: {
  path: string;
  extension?: string;
  children?: unknown;
}): BulkMarkSource | null {
  if (Array.isArray(entry.children)) {
    return { path: entry.path, kind: "folder" };
  }
  if (typeof entry.extension === "string") {
    const ext = entry.extension.toLowerCase();
    if (ext === "md" || ext === "pdf") {
      return { path: entry.path, kind: "file" };
    }
  }
  return null;
}

/**
 * Expand folders + files to a unique, path-sorted candidate list.
 * Preview equals this attempted set; runtime failures are reported separately.
 */
export function assembleBulkMarkCandidates(
  files: readonly FolderFileRef[],
  sources: readonly BulkMarkSource[],
  skipPaths: ReadonlySet<string>,
): FolderFileRef[] {
  const byPath = new Map<string, FolderFileRef>();
  for (const source of sources) {
    if (source.kind === "folder") {
      for (const ref of folderTopicCandidates(files, source.path, skipPaths)) {
        byPath.set(ref.path, ref);
      }
      continue;
    }
    if (skipPaths.has(source.path)) continue;
    const hit = files.find((f) => f.path === source.path);
    if (!hit) continue;
    const ext = hit.extension.toLowerCase();
    if (ext !== "md" && ext !== "pdf") continue;
    byPath.set(hit.path, hit);
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function validatePriorityBounds(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  if (n < PRIORITY_MIN || n > PRIORITY_MAX) return clampPriority(n);
  return n;
}
