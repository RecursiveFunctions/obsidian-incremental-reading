/**
 * Locate an image embed inside a markdown body so an image extract can be
 * anchored byte-exactly on the `![[...]]` / `![](...)` markup the user's
 * note already contains. Pure: no Obsidian API.
 */

export interface EmbedRange {
  start: number;
  end: number;
  /** The markup slice, e.g. `![[pic.png|300]]`. */
  markup: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the embed whose link target ends with `linkpath` (basename or full
 * path, with or without extension folder). Prefers a unique match; when the
 * same image is embedded twice, `nth` picks which occurrence (0-based).
 */
export function findImageEmbedRange(
  body: string,
  linkpath: string,
  nth = 0,
): EmbedRange | null {
  const target = linkpath.replace(/^\/+/, "");
  const base = target.split("/").pop() ?? target;
  const wiki = new RegExp(
    `!\\[\\[(?:[^\\]|#]*?/)?${escapeRe(base)}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`,
    "g",
  );
  const md = new RegExp(
    `!\\[[^\\]]*\\]\\((?:<)?(?:[^)\\s]*?/)?${escapeRe(base)}(?:>)?(?:\\s+"[^"]*")?\\)`,
    "g",
  );
  const hits: EmbedRange[] = [];
  for (const re of [wiki, md]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      hits.push({ start: m.index, end: m.index + m[0].length, markup: m[0] });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  return hits[nth] ?? null;
}

/** Wikilink embed text for an extract body: `![[path]]`. */
export function imageEmbedMarkup(path: string): string {
  return `![[${path}]]`;
}
