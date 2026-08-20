/**
 * Pure per-topic reading-position store (v0.2 roadmap item).
 *
 * This module provides immutable, deterministic bookmark management
 * for tracking reading positions across topics. All operations are pure
 * functions with no side effects.
 */

import type { ElementId } from "./ids";

/**
 * A bookmark represents the reading position for a specific element.
 * All fields are required for deterministic serialization.
 */
export interface Bookmark {
  elementId: ElementId;
  line: number;
  ch: number;
  scrollTop: number;
  updatedAt: number;
  /**
   * 0–1 how far through the topic body. Shared between reader and editor
   * because pixel `scrollTop` is not comparable across those viewports.
   * Absent on bookmarks written before 0.6.19.
   */
  progress?: number;
  /** 1-based PDF page when the source is a PDF. Absent on markdown bookmarks. */
  page?: number;
}

/** A map of element IDs to their bookmarks, kept sorted for determinism. */
export type BookmarkMap = Record<string, Bookmark>;

/**
 * Set a bookmark, replacing any existing entry for the same elementId.
 * Returns a new map with the bookmark added/updated, never mutating input.
 * The map is kept sorted by elementId for deterministic JSON output.
 */
export function setBookmark(state: BookmarkMap, b: Bookmark): BookmarkMap {
  const newState = { ...state };
  newState[b.elementId] = b;
  
  // Return sorted keys to ensure deterministic JSON output
  return Object.keys(newState)
    .sort()
    .reduce((acc, key) => {
      acc[key] = newState[key];
      return acc;
    }, {} as BookmarkMap);
}

/**
 * Get a bookmark by elementId or string id.
 * Returns null (not undefined) when the id is not present.
 */
export function getBookmark(state: BookmarkMap, id: ElementId | string): Bookmark | null {
  const bookmark = state[id as string];
  return bookmark ? bookmark : null;
}

/**
 * Clear a bookmark by elementId or string id.
 * Returns a new map without the specified entry.
 * Idempotent: clearing a missing id returns a value equal to input.
 */
export function clearBookmark(state: BookmarkMap, id: ElementId | string): BookmarkMap {
  const { [id as string]: _, ...rest } = state;
  return rest;
}

/**
 * Return the `n` most-recently-updated bookmarks, newest first.
 *
 * Ties on `updatedAt` are broken by elementId in ascending order so the
 * output is deterministic for tests and stable across re-renders. Pass
 * `n = Infinity` (or omit) to get the full sorted list; pass a positive
 * integer to truncate.
 *
 * Pure: callers (the tree-view recent-reading section, the
 * resume-last-read command) supply the map they already loaded.
 */
export function recentBookmarks(state: BookmarkMap, n = Infinity): Bookmark[] {
  const list = Object.values(state);
  list.sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.elementId < b.elementId ? -1 : a.elementId > b.elementId ? 1 : 0;
  });
  // Distinguish "give me everything" (Infinity or omitted) from "zero or
  // negative" (the caller asked for an empty slice). Returning `list` on
  // both paths quietly hides UI bugs where a count of 0 should still
  // render the empty state.
  if (n <= 0) return [];
  if (!Number.isFinite(n)) return list;
  return list.slice(0, Math.floor(n));
}

/** Most recently-updated bookmark, or `null` if the map is empty. */
export function mostRecentBookmark(state: BookmarkMap): Bookmark | null {
  const [first] = recentBookmarks(state, 1);
  return first ?? null;
}