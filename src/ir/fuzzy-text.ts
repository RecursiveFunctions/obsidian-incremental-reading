/**
 * Formatting-tolerant text matching shared by the review card painter and
 * the "map a rendered selection back to markdown" fallback.
 *
 * `Normalizer` applies the same rules as `normalizeForMatch` in anchor.ts
 * (drop markdown emphasis characters, collapse whitespace runs to one
 * space, trim the lead) but remembers where every kept character came
 * from, so a hit in normalized space maps back to raw offsets or to DOM
 * text nodes. Pure: no Obsidian API.
 */

const SYNTAX = new Set(["*", "_", "`", "~", "#"]);
const WS = new Set([" ", "\t", "\n", "\r", " "]);

export class Normalizer<Ref> {
  text = "";
  refs: Ref[] = [];
  private pendingSpace = false;

  push(ch: string, ref: Ref): void {
    if (SYNTAX.has(ch)) return;
    if (WS.has(ch)) {
      if (this.text.length > 0) this.pendingSpace = true;
      return;
    }
    if (this.pendingSpace) {
      // Attribute the collapsed space to the char that follows it, so a
      // match boundary never lands on a dropped whitespace run.
      this.text += " ";
      this.refs.push(ref);
      this.pendingSpace = false;
    }
    this.text += ch;
    this.refs.push(ref);
  }
}


/**
 * Characters of markdown link syntax that the renderer never shows, so a
 * needle taken from rendered text can still be located in raw markdown.
 * `[label](url)` shows `label`; `[[note|alias]]` shows `alias`; images and
 * embeds show no text at all.
 */
export function hiddenLinkChrome(raw: string): boolean[] {
  const hidden = new Array<boolean>(raw.length).fill(false);
  const hide = (from: number, to: number): void => {
    for (let i = Math.max(0, from); i < Math.min(raw.length, to); i += 1) {
      hidden[i] = true;
    }
  };
  for (const m of raw.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (m[1]) {
      hide(start, end); // `![[embed]]` renders as an image
      continue;
    }
    const inner = m[2] ?? "";
    const pipe = inner.indexOf("|");
    // Visible part: the alias when there is one, else the whole target.
    hide(start, start + 2 + (pipe === -1 ? 0 : pipe + 1));
    hide(end - 2, end);
  }
  for (const m of raw.matchAll(/(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (m[1]) {
      hide(start, end); // `![alt](url)` renders as an image
      continue;
    }
    hide(start, start + 1); // `[`
    hide(start + 1 + (m[2] ?? "").length, end); // `](url)`
  }
  return hidden;
}

/** Normalized form of a needle (no refs needed). */
export function normalizeNeedle(s: string): string {
  const n = new Normalizer<number>();
  for (let i = 0; i < s.length; i++) n.push(s[i]!, i);
  return n.text;
}

/**
 * Locate `needle` in `raw` ignoring markdown emphasis and whitespace
 * shape. Returns raw offsets when the normalized needle occurs exactly
 * once (ambiguous hits return null rather than guessing).
 */
export function fuzzyLocateInBody(
  raw: string,
  needle: string,
): { start: number; end: number; text: string } | null {
  const nn = normalizeNeedle(needle);
  if (nn.length < 2) return null;
  const n = new Normalizer<number>();
  // The needle comes from rendered text, which has no link syntax in it, so
  // the raw side drops the link chrome before matching.
  const hidden = hiddenLinkChrome(raw);
  for (let i = 0; i < raw.length; i++) {
    if (hidden[i]) continue;
    n.push(raw[i]!, i);
  }
  const first = n.text.indexOf(nn);
  if (first === -1) return null;
  if (n.text.indexOf(nn, first + 1) !== -1) return null;
  let start = n.refs[first]!;
  let end = n.refs[first + nn.length - 1]! + 1;
  // Swallow the emphasis markers and link chrome that hug the match
  // (`**quick**`, `[label](url)`) so the anchored slice is whole markdown,
  // not a token cut mid-syntax.
  while (start > 0 && (SYNTAX.has(raw[start - 1]!) || hidden[start - 1]!)) {
    start -= 1;
  }
  while (end < raw.length && (SYNTAX.has(raw[end]!) || hidden[end]!)) end += 1;
  return { start, end, text: raw.slice(start, end) };
}
