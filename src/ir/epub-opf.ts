/**
 * Pure EPUB container, OPF metadata/manifest/spine, and NCX/nav TOC parser.
 * Parses XML/XHTML tags by local name with zero namespace URL literals.
 */

import { decodeHtmlEntities } from "./html-to-markdown";

export interface EpubManifestItem {
  id: string;
  href: string;
  fullPath: string;
  mediaType: string;
  properties: string;
}

export interface ParsedOpf {
  title: string;
  author: string;
  language: string;
  manifestById: Map<string, EpubManifestItem>;
  spineIds: string[];
  tocAttrId: string;
}

export function normalizeArchivePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

export function dirnameOfArchive(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(0, idx) : "";
}

export function resolveArchiveRelative(baseDir: string, rawHref: string): string {
  const noHash = rawHref.split("#")[0] ?? "";
  const noQuery = noHash.split("?")[0] ?? "";
  let decoded = noQuery.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep raw path when percent-encoding is malformed.
  }
  return normalizeArchivePath(baseDir ? `${baseDir}/${decoded}` : decoded);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export function lookupZipEntry(
  entries: Map<string, Uint8Array>,
  path: string,
): { path: string; bytes: Uint8Array } | null {
  const direct = entries.get(path);
  if (direct) return { path, bytes: direct };
  const lower = path.toLowerCase();
  for (const [k, v] of entries) {
    if (k.toLowerCase() === lower) return { path: k, bytes: v };
  }
  return null;
}

function readXmlAttr(attrs: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\s)(?:[a-z0-9_-]+:)?${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const m = attrs.match(re);
  return m ? decodeHtmlEntities((m[1] ?? m[2] ?? "").trim()) : "";
}

export function firstXmlTagText(xml: string, localTagName: string): string {
  const re = new RegExp(
    `<(?:[a-z0-9_-]+:)?${localTagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[a-z0-9_-]+:)?${localTagName}>`,
    "i",
  );
  const m = xml.match(re);
  if (!m) return "";
  return decodeHtmlEntities(m[1]!.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export function findOpfPath(entries: Map<string, Uint8Array>): string | null {
  const container = lookupZipEntry(entries, "META-INF/container.xml");
  if (container) {
    const xml = decodeUtf8(container.bytes);
    const rootfileRe = /<(?:[a-z0-9_-]+:)?rootfile\b([^>]*)\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = rootfileRe.exec(xml)) !== null) {
      const fullPath = readXmlAttr(m[1]!, "full-path");
      if (fullPath) return normalizeArchivePath(fullPath);
    }
  }
  for (const path of entries.keys()) {
    if (path.toLowerCase().endsWith(".opf")) return path;
  }
  return null;
}

export function parseOpf(opfXml: string, opfPath: string): ParsedOpf {
  const opfDir = dirnameOfArchive(opfPath);
  const metadataMatch = opfXml.match(
    /<(?:[a-z0-9_-]+:)?metadata\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?metadata>/i,
  );
  const metaXml = metadataMatch ? metadataMatch[1]! : opfXml;

  const manifestById = new Map<string, EpubManifestItem>();
  const itemRe = /<(?:[a-z0-9_-]+:)?item\b([^>]*)\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(opfXml)) !== null) {
    const attrs = im[1]!;
    const id = readXmlAttr(attrs, "id");
    const href = readXmlAttr(attrs, "href");
    if (!id || !href) continue;
    manifestById.set(id, {
      id,
      href,
      fullPath: resolveArchiveRelative(opfDir, href),
      mediaType: readXmlAttr(attrs, "media-type").toLowerCase(),
      properties: readXmlAttr(attrs, "properties").toLowerCase(),
    });
  }

  const spineOpen = opfXml.match(/<(?:[a-z0-9_-]+:)?spine\b([^>]*)>/i);
  const tocAttrId = spineOpen ? readXmlAttr(spineOpen[1]!, "toc") : "";
  const spineIds: string[] = [];
  const itemrefRe = /<(?:[a-z0-9_-]+:)?itemref\b([^>]*)\/?>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = itemrefRe.exec(opfXml)) !== null) {
    const idref = readXmlAttr(rm[1]!, "idref");
    if (idref) spineIds.push(idref);
  }

  return {
    title: firstXmlTagText(metaXml, "title"),
    author: firstXmlTagText(metaXml, "creator"),
    language: firstXmlTagText(metaXml, "language"),
    manifestById,
    spineIds,
    tocAttrId,
  };
}

export function parseNavToc(navHtml: string, navDir: string): Map<string, string> {
  const titles = new Map<string, string>();
  const navMatch =
    navHtml.match(/<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i) ??
    navHtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i);
  const scope = navMatch ? navMatch[1]! : navHtml;
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(scope)) !== null) {
    const href = readXmlAttr(m[1]!, "href");
    const label = decodeHtmlEntities(m[2]!.replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (!href || !label) continue;
    const resolved = resolveArchiveRelative(navDir, href);
    if (resolved && !titles.has(resolved)) titles.set(resolved, label);
  }
  return titles;
}

export function parseNcxToc(ncxXml: string, ncxDir: string): Map<string, string> {
  const titles = new Map<string, string>();
  const pointRe =
    /<(?:[a-z0-9_-]+:)?navPoint\b[^>]*>([\s\S]*?)<(?:[a-z0-9_-]+:)?content\b([^>]*)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = pointRe.exec(ncxXml)) !== null) {
    const label = firstXmlTagText(m[1]!, "text");
    const src = readXmlAttr(m[2]!, "src");
    if (!label || !src) continue;
    const resolved = resolveArchiveRelative(ncxDir, src);
    if (resolved && !titles.has(resolved)) titles.set(resolved, label);
  }
  return titles;
}
