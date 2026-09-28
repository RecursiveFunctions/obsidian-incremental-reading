/** Bind a transient selection to the leaf and file that produced it. */
export type ScopedSelectionSnapshot<T> = {
  leaf: object;
  filePath: string;
  value: T;
};

export function scopeSelectionSnapshot<T>(
  leaf: object,
  filePath: string,
  value: T,
): ScopedSelectionSnapshot<T> {
  return { leaf, filePath, value };
}

export function isScopedSelectionCurrent<T>(
  snapshot: ScopedSelectionSnapshot<T> | null,
  leaf: object | null | undefined,
  filePath: string | null | undefined,
): snapshot is ScopedSelectionSnapshot<T> {
  return !!snapshot && snapshot.leaf === leaf && snapshot.filePath === filePath;
}
