/**
 * Shared HTML/XHTML-to-Markdown converter used by SuperMemo collection imports,
 * EPUB chapters, and standalone HTML imports. Pure string transform; zero network
 * literals (`scripts/check-zero-network.mjs`).
 */

import { isSafeVaultRelativePath } from "./source-paths";

export interface HtmlToMarkdownOptions {
  /**
   * Resolve an `<img src>` or SVG `<image href>` target to a vault-relative
   * attachment path or filename for `![[embed]]`. Returning `null` omits the embed.
   */
  resolveAssetPath?: (rawSrc: string) => string | null;
  /**
   * Optional resolver for internal `<a href>` targets (e.g. EPUB chapter links).
   * Returning a wikilink target rewrites `[label]` to `[[target|label]]`.
   */
  resolveLinkTarget?: (rawHref: string) => string | null;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&#([0-9]+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : "";
    })
    .replace(/&([a-z0-9]+);/gi, (full, name: string) => {
      const hit = NAMED_ENTITIES[name.toLowerCase()];
      return hit !== undefined ? hit : full;
    });
}

function readAttr(tagAttrs: string, attrNames: string[]): string {
  for (const name of attrNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
    const m = tagAttrs.match(re);
    if (m) {
      return decodeHtmlEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
    }
  }
  return "";
}

function stripTagsInline(raw: string): string {
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function convertTable(tableHtml: string, options: HtmlToMarkdownOptions): string {
  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(tableHtml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]!)) !== null) {
      const text = htmlToMarkdown(cm[2]!, options)
        .replace(/\n+/g, " ")
        .replace(/\|/g, "\\|")
        .trim();
      cells.push(text);
    }
    if (cells.length > 0) rows.push(cells);
  }
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    const copy = r.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });
  const header = `| ${padded[0]!.join(" | ")} |`;
  const sep = `| ${padded[0]!.map(() => "---").join(" | ")} |`;
  const body = padded.slice(1).map((r) => `| ${r.join(" | ")} |`);
  return `\n\n${[header, sep, ...body].join("\n")}\n\n`;
}

function convertList(
  listHtml: string,
  ordered: boolean,
  options: HtmlToMarkdownOptions,
): string {
  const items: string[] = [];
  const itemRe = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let im: RegExpExecArray | null;
  let index = 1;
  while ((im = itemRe.exec(listHtml)) !== null) {
    const content = htmlToMarkdown(im[1]!, options).trim();
    if (!content) continue;
    const prefix = ordered ? `${index}. ` : "- ";
    const lines = content.split("\n");
    const first = `${prefix}${lines[0]}`;
    const rest = lines.slice(1).map((l) => (l ? `  ${l}` : ""));
    items.push([first, ...rest].join("\n"));
    index += 1;
  }
  return items.length > 0 ? `\n\n${items.join("\n")}\n\n` : "";
}

function formatImageEmbed(
  rawSrc: string,
  alt: string,
  options: HtmlToMarkdownOptions,
): string {
  if (!rawSrc) return alt;
  if (options.resolveAssetPath) {
    const resolved = options.resolveAssetPath(rawSrc);
    return resolved ? `\n\n![[${resolved}]]\n\n` : alt;
  }
  if (/^data:/i.test(rawSrc) || /^[a-z][a-z0-9+.-]*:/i.test(rawSrc)) {
    return alt;
  }
  const cleanSrc = rawSrc.trim().replace(/^\/+/, "");
  if (!isSafeVaultRelativePath(cleanSrc)) {
    return alt;
  }
  return `\n\n![[${cleanSrc}]]\n\n`;
}

export function htmlToMarkdown(
  html: string,
  options: HtmlToMarkdownOptions = {},
): string {
  if (!html) return "";

  const codeTokens: string[] = [];
  const stashCode = (md: string): string => {
    const token = `\uE000IRCODE${codeTokens.length}\uE001`;
    codeTokens.push(md);
    return token;
  };

  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style|noscript|iframe|object|embed|applet)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(?:iframe|object|embed|applet|meta|link|base)\b[^>]*\/?>/gi, "");

  // Fenced code blocks (<pre><code ...>...</code></pre> and bare <pre>...</pre>)
  s = s.replace(
    /<pre\b[^>]*>\s*(?:<code\b([^>]*)>([\s\S]*?)<\/code>|([\s\S]*?))\s*<\/pre>/gi,
    (_, codeAttrs: string | undefined, innerCode: string | undefined, barePre: string | undefined) => {
      const rawCode = innerCode ?? barePre ?? "";
      const classAttr = codeAttrs ? readAttr(codeAttrs, ["class"]) : "";
      const langMatch = classAttr.match(/(?:^|\s)language-([a-z0-9_+-]+)/i);
      const lang = langMatch ? langMatch[1] : "";
      const text = decodeHtmlEntities(rawCode.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
        .replace(/\r\n/g, "\n")
        .replace(/^\n+|\n+$/g, "");
      return stashCode(`\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`);
    },
  );

  // Inline <code>
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => {
    const text = decodeHtmlEntities(inner.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text) return "";
    const fence = text.includes("`") ? "``" : "`";
    return stashCode(`${fence}${text}${fence}`);
  });

  // Images and SVG <image>
  s = s.replace(/<img\b([^>]*)\/?>/gi, (_, attrs: string) => {
    const src = readAttr(attrs, ["src", "data-src"]);
    const alt = readAttr(attrs, ["alt", "title"]);
    return formatImageEmbed(src, alt, options);
  });
  s = s.replace(/<image\b([^>]*)(?:\/>|>[\s\S]*?<\/image>)/gi, (_, attrs: string) => {
    const src = readAttr(attrs, ["href", "xlink:href"]);
    return formatImageEmbed(src, "", options);
  });

  // Tables (non-nested innermost-safe pass)
  s = s.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, inner: string) =>
    convertTable(inner, options),
  );

  // Lists (innermost first so nested lists work cleanly)
  for (let pass = 0; pass < 4; pass += 1) {
    const next = s.replace(
      /<(ul|ol)\b[^>]*>((?:(?!<(?:ul|ol)\b)[\s\S])*?)<\/\1>/gi,
      (_, tag: string, inner: string) =>
        convertList(inner, tag.toLowerCase() === "ol", options),
    );
    if (next === s) break;
    s = next;
  }

  // Blockquotes (innermost first)
  for (let pass = 0; pass < 3; pass += 1) {
    const next = s.replace(
      /<blockquote\b[^>]*>((?:(?!<blockquote\b)[\s\S])*?)<\/blockquote>/gi,
      (_, inner: string) => {
        const md = htmlToMarkdown(inner, options).trim();
        if (!md) return "";
        const quoted = md
          .split("\n")
          .map((line) => (line ? `> ${line}` : ">"))
          .join("\n");
        return `\n\n${quoted}\n\n`;
      },
    );
    if (next === s) break;
    s = next;
  }

  // Headings
  s = s.replace(
    /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, level: string, inner: string) => {
      const text = htmlToMarkdown(inner, options).replace(/\n+/g, " ").trim();
      return text ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : "";
    },
  );

  // Links
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, inner: string) => {
    const href = readAttr(attrs, ["href"]);
    const label = stripTagsInline(inner) || href;
    if (!label) return "";
    if (options.resolveLinkTarget && href) {
      const target = options.resolveLinkTarget(href);
      if (target) {
        return target === label ? `[[${target}]]` : `[[${target}|${label}]]`;
      }
    }
    if (!href || href.startsWith("#")) return label;
    if (/^(?:mailto:|https?:)/i.test(href)) return `[${label}](${href})`;
    return label;
  });

  // Inline formatting & breaks
  s = s
    .replace(/<hr\b[^>]*\/?>/gi, "\n\n---\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, t: string) => {
      const trimmed = t.trim();
      return trimmed ? `**${trimmed}**` : "";
    })
    .replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, t: string) => {
      const trimmed = t.trim();
      return trimmed ? `*${trimmed}*` : "";
    })
    .replace(/<(?:del|s)\b[^>]*>([\s\S]*?)<\/(?:del|s)>/gi, (_, t: string) => {
      const trimmed = t.trim();
      return trimmed ? `~~${trimmed}~~` : "";
    })
    .replace(/<mark\b[^>]*>([\s\S]*?)<\/mark>/gi, (_, t: string) => {
      const trimmed = t.trim();
      return trimmed ? `==${trimmed}==` : "";
    })
    .replace(/<\/(?:p|div|section|article|header|footer|aside|figcaption|figure|tr)>/gi, "\n\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  s = decodeHtmlEntities(s).replace(/</g, "&lt;");

  // Restore stashed code blocks / inline code
  s = s.replace(/\uE000IRCODE(\d+)\uE001/g, (_, idx: string) => codeTokens[Number(idx)] ?? "");

  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
