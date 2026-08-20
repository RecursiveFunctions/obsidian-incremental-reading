/**
 * Which vault files would become IR topics if the user marks a folder.
 * Recursive: every markdown/PDF under the folder, not already in IR.
 * Pure: no Obsidian, no I/O.
 */

export function isPathInFolder(filePath: string, folderPath: string): boolean {
  if (folderPath === "" || folderPath === "/") return true;
  const prefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
  return filePath.startsWith(prefix);
}

export interface FolderFileRef {
  path: string;
  extension: string;
}

/**
 * Candidates to mark. `skipPaths` is already-IR (topic/extract/item, or a
 * store-only PDF topic). Nested folders are included.
 */
export function folderTopicCandidates(
  files: readonly FolderFileRef[],
  folderPath: string,
  skipPaths: ReadonlySet<string>,
): FolderFileRef[] {
  const out: FolderFileRef[] = [];
  for (const f of files) {
    const ext = f.extension.toLowerCase();
    if (ext !== "md" && ext !== "pdf") continue;
    if (!isPathInFolder(f.path, folderPath)) continue;
    if (skipPaths.has(f.path)) continue;
    out.push(f);
  }
  return out;
}
