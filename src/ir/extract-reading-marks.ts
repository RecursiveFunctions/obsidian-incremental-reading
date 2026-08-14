/**
 * Reading-view extract highlight policy (DESIGN §Q3). Pure helpers so
 * tests do not load the CodeMirror decoration module.
 *
 * Identical quotes each get a mark at the Nth occurrence. Needles shorter
 * than 4 characters are skipped to avoid noisy matches.
 */

const MIN_NEEDLE = 4;

export function readingViewNeedlePasses(
  ranges: ReadonlyArray<{ text: string }>,
): { needle: string; n: number }[] {
  const counts = new Map<string, number>();
  const out: { needle: string; n: number }[] = [];
  for (const r of ranges) {
    const needle = r.text.trim();
    if (needle.length < MIN_NEEDLE) continue;
    const n = counts.get(needle) ?? 0;
    counts.set(needle, n + 1);
    out.push({ needle, n });
  }
  return out;
}

/** Offset of the `n`-th (0-based) occurrence of `needle` in `haystack`. */
export function nthOccurrenceOffset(
  haystack: string,
  needle: string,
  n: number,
): number {
  if (!needle || n < 0) return -1;
  let from = 0;
  let seen = 0;
  while (from <= haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return -1;
    if (seen === n) return idx;
    seen += 1;
    from = idx + 1;
  }
  return -1;
}
