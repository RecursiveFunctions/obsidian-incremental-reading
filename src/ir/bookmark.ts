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