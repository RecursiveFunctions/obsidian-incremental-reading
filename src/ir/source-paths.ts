/**
 * Rewrite stored note/anchor paths after a vault rename or move.
 *
 * Element ids are stable; `notePath` / `anchor.sourcePath` are not. A folder
 * rename only fires `vault.on("rename")` for the folder, so every stored path
 * under that prefix has to move with it. Unique-basename matching covers the
 * delete+create pattern some folder moves use instead of rename.
 */

import type { IrElement } from "./model";
import type { ElementId } from "./ids";

export function dirnameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

export function basenameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

/** True when `path` is `folder` or a file/folder inside it. */
export function pathIsUnder(path: string, folder: string): boolean {
  if (folder === "" || folder === "/") return true;
  return path === folder || path.startsWith(`${folder}/`);
}

/**
 * Map a stored path when `from` was renamed/moved to `to`.
 * `from` may be a file or a folder (no trailing slash).
 */
export function rewriteStoredPath(
  stored: string,
  from: string,
  to: string,
): string | null {
  if (!stored || from === to) return null;
  if (stored === from) return to;
  const prefix = from.endsWith("/") ? from : `${from}/`;
  if (!stored.startsWith(prefix)) return null;
  const rest = stored.slice(prefix.length);
  if (to === "" || to === "/") return rest;
  const toPrefix = to.endsWith("/") ? to : `${to}/`;
  return `${toPrefix}${rest}`;
}

/**
 * Inverse of `relocatedBySuffix`: given the new path, find the unique
 * old path it still ends with (`Archive/Papers/a.md` ← `Papers/a.md`).
 * Several suffix hits: keep the longest (most specific) if it is unique.
 */
export function originalPathBySuffix(
  newPath: string,
  oldPaths: Iterable<string>,
): string | null {
  const hits: string[] = [];
  for (const old of oldPaths) {
    if (!old || old === newPath) continue;
    if (newPath.endsWith(`/${old}`)) hits.push(old);
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!;
  hits.sort((a, b) => b.length - a.length);
  if (hits[0]!.length > hits[1]!.length) return hits[0]!;
  return null;
}

/**
 * If the file kept its relative path under a new parent
 * (`Papers/a.md` → `Archive/Papers/a.md`), return that unique hit.
 */
export function relocatedBySuffix(
  gonePath: string,
  existingPaths: Iterable<string>,
): string | null {
  const needle = `/${gonePath}`;
  const hits: string[] = [];
  for (const p of existingPaths) {
    if (p === gonePath) continue;
    if (p.endsWith(needle)) hits.push(p);
    if (hits.length > 1) return null;
  }
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * If exactly one existing file shares the gone path's basename, that is
 * the move target. Ambiguous names return null.
 */
export function uniqueMovedPath(
  gonePath: string,
  existingPaths: Iterable<string>,
): string | null {
  const base = basenameOf(gonePath);
  if (!base) return null;
  const hits: string[] = [];
  for (const p of existingPaths) {
    if (p === gonePath) continue;
    if (basenameOf(p) === base) hits.push(p);
    if (hits.length > 1) return null;
  }
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * When several missing files uniquely match under the same new folder,
 * the whole prefix moved. Needs at least two agreeing pairs.
 */
export function inferPrefixRewrite(
  missingPaths: string[],
  existingPaths: Iterable<string>,
): { from: string; to: string } | null {
  const existing = Array.from(existingPaths);
  const votes = new Map<string, number>();
  for (const gone of missingPaths) {
    const hit =
      relocatedBySuffix(gone, existing) ?? uniqueMovedPath(gone, existing);
    if (!hit) continue;
    const from = dirnameOf(gone);
    const to = dirnameOf(hit);
    if (from === to) continue;
    const key = `${from}\n${to}`;
    votes.set(key, (votes.get(key) ?? 0) + 1);
  }
  let best: { from: string; to: string; n: number } | null = null;
  for (const [key, n] of votes) {
    if (n < 2) continue;
    if (!best || n > best.n) {
      const sep = key.indexOf("\n");
      best = { from: key.slice(0, sep), to: key.slice(sep + 1), n };
    }
  }
  return best ? { from: best.from, to: best.to } : null;
}

export interface SourcePathRewrite {
  elementId: ElementId;
  oldPath: string;
  newPath: string;
}

/**
 * Per-element rewrites when `from` (file or folder) moved to `to`.
 * One record per element per distinct (old,new) pair so a single
 * `source-renamed` event can update both `notePath` and `anchor.sourcePath`.
 */
export function sourcePathRewrites(
  elements: Iterable<IrElement>,
  from: string,
  to: string,
): SourcePathRewrite[] {
  const out: SourcePathRewrite[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const candidates = [el.notePath, el.anchor?.sourcePath];
    for (const stored of candidates) {
      if (!stored) continue;
      const next = rewriteStoredPath(stored, from, to);
      if (!next || next === stored) continue;
      const key = `${el.id}\0${stored}\0${next}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ elementId: el.id, oldPath: stored, newPath: next });
    }
  }
  out.sort(
    (a, b) =>
      a.elementId.localeCompare(b.elementId) ||
      a.oldPath.localeCompare(b.oldPath),
  );
  return out;
}
