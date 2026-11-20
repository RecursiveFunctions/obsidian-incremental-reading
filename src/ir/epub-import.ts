/**
 * Pure EPUB & HTML document import planner.
 * Emits a Book parent topic + Chapter child topics (with A-Factor & priority spread)
 * and vault attachment plans, plus standalone HTML topic plans.
 */

import {
  computeTopicAFactorFromTextLength,
  spreadExtractPriority,
} from "../sm18-ir-mechanics";
import { decodeHtmlEntities, htmlToMarkdown } from "./html-to-markdown";
import {
  decodeUtf8,
  dirnameOfArchive,
  findOpfPath,
  firstXmlTagText,
  lookupZipEntry,
  parseNavToc,
  parseNcxToc,
  parseOpf,
  resolveArchiveRelative,
  type EpubManifestItem,
} from "./epub-opf";
import { newEventId, type DeviceId, type ElementId } from "./ids";
import { elementIdForPath } from "./migrate";
import {
  clampPriority,
  newElement,
  type IrElement,
  type IrEvent,
  type ReadSchedule,
} from "./model";

export interface PlanEpubImportInput {
  zipEntries: Map<string, Uint8Array>;
  extractFolder: string;
  attachmentFolder?: string;
  defaultPriority: number;
  now: number;
  deviceId: DeviceId;
  fileNameHint?: string;
  existingPaths?: Set<string>;
  rng?: () => number;
}

export interface EpubPlannedNote {
  role: "book" | "chapter";
  title: string;
  path: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
  elementId: ElementId;
  parentId: ElementId | null;
  priority: number;
  schedule: ReadSchedule;
}

export interface EpubPlannedAttachment {
  vaultPath: string;
  bytes: Uint8Array;
}

export interface EpubImportPlan {
  bookTitle: string;
  author?: string;
  language?: string;
  bookPath: string;
  notes: EpubPlannedNote[];
  attachments: EpubPlannedAttachment[];
  events: IrEvent[];
}

export interface PlanHtmlImportInput {
  html: string;
  fileName: string;
  extractFolder: string;
  defaultPriority: number;
  now: number;
  deviceId: DeviceId;
  existingPaths?: Set<string>;
}

export interface HtmlImportPlan {
  title: string;
  path: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
  elementId: ElementId;
  event: IrEvent;
}

function sanitizeStem(raw: string, fallback: string): string {
  const cleaned = decodeHtmlEntities(raw)
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
  return cleaned || fallback;
}

function uniqueVaultPath(desiredPath: string, used: Set<string>): string {
  if (!used.has(desiredPath)) {
    used.add(desiredPath);
    return desiredPath;
  }
  const dot = desiredPath.lastIndexOf(".");
  const stem = dot >= 0 ? desiredPath.slice(0, dot) : desiredPath;
  const ext = dot >= 0 ? desiredPath.slice(dot) : "";
  let n = 2;
  while (used.has(`${stem} ${n}${ext}`)) n += 1;
  const unique = `${stem} ${n}${ext}`;
  used.add(unique);
  return unique;
}

function isHtmlManifestItem(item: EpubManifestItem): boolean {
  return item.mediaType.includes("html") || /\.(?:x?html?|htm)$/i.test(item.fullPath);
}

function extractChapterTitle(html: string): string {
  return (
    firstXmlTagText(html, "h1") ||
    firstXmlTagText(html, "h2") ||
    firstXmlTagText(html, "title")
  );
}

export function planEpubImport(input: PlanEpubImportInput): EpubImportPlan {
  const opfPath = findOpfPath(input.zipEntries);
  if (!opfPath) throw new Error("Invalid EPUB archive: missing OPF package document.");
  const opfEntry = lookupZipEntry(input.zipEntries, opfPath);
  if (!opfEntry) throw new Error(`Invalid EPUB archive: package file "${opfPath}" not found.`);

  const opf = parseOpf(decodeUtf8(opfEntry.bytes), opfEntry.path);
  const baseHint = input.fileNameHint ? input.fileNameHint.replace(/\.epub$/i, "") : "Untitled EPUB";
  const bookTitle = sanitizeStem(opf.title || baseHint, "Untitled EPUB");

  const tocTitles = new Map<string, string>();
  for (const item of opf.manifestById.values()) {
    if (item.properties.split(/\s+/).includes("nav")) {
      const navEntry = lookupZipEntry(input.zipEntries, item.fullPath);
      if (navEntry) {
        for (const [k, v] of parseNavToc(decodeUtf8(navEntry.bytes), dirnameOfArchive(item.fullPath))) {
          tocTitles.set(k, v);
        }
      }
      break;
    }
  }
  if (tocTitles.size === 0) {
    const ncxItem =
      (opf.tocAttrId ? opf.manifestById.get(opf.tocAttrId) : undefined) ??
      Array.from(opf.manifestById.values()).find(
        (it) => it.mediaType.includes("ncx") || it.fullPath.toLowerCase().endsWith(".ncx"),
      );
    if (ncxItem) {
      const ncxEntry = lookupZipEntry(input.zipEntries, ncxItem.fullPath);
      if (ncxEntry) {
        for (const [k, v] of parseNcxToc(decodeUtf8(ncxEntry.bytes), dirnameOfArchive(ncxItem.fullPath))) {
          tocTitles.set(k, v);
        }
      }
    }
  }

  const usedPaths = new Set<string>(input.existingPaths ?? []);
  const cleanExtractDir = input.extractFolder.trim().replace(/^\/+|\/+$/g, "");
  const cleanAttachDir = (input.attachmentFolder ?? `${cleanExtractDir || "IR"}/attachments`)
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const bookFolder = cleanExtractDir ? `${cleanExtractDir}/${bookTitle}` : bookTitle;
  const bookPath = uniqueVaultPath(`${bookFolder}/${bookTitle}.md`, usedPaths);
  const bookElementId = elementIdForPath(bookPath);
  const bookPriority = clampPriority(input.defaultPriority);

  const spineItems: EpubManifestItem[] = [];
  for (const idref of opf.spineIds) {
    const item = opf.manifestById.get(idref);
    if (item && isHtmlManifestItem(item)) spineItems.push(item);
  }
  if (spineItems.length === 0) {
    for (const item of opf.manifestById.values()) {
      if (isHtmlManifestItem(item)) spineItems.push(item);
    }
  }
  if (spineItems.length === 0) throw new Error("EPUB archive contains no readable HTML/XHTML chapters.");

  const chapterMeta: Array<{ item: EpubManifestItem; html: string; title: string; vaultPath: string }> = [];
  const chapterPathByZipPath = new Map<string, string>();
  const padWidth = Math.max(2, String(spineItems.length).length);

  for (let i = 0; i < spineItems.length; i += 1) {
    const item = spineItems[i]!;
    const entry = lookupZipEntry(input.zipEntries, item.fullPath);
    if (!entry) continue;
    const html = decodeUtf8(entry.bytes);
    const rawTitle = tocTitles.get(item.fullPath) ?? extractChapterTitle(html) ?? `Chapter ${i + 1}`;
    const displayTitle =
      decodeHtmlEntities(rawTitle).replace(/[\[\]|]/g, " ").replace(/\s+/g, " ").trim() ||
      `Chapter ${i + 1}`;
    const fileStem = sanitizeStem(rawTitle || `Chapter ${i + 1}`, `Chapter ${i + 1}`);
    const prefix = String(chapterMeta.length + 1).padStart(padWidth, "0");
    const vaultPath = uniqueVaultPath(`${bookFolder}/${prefix} - ${fileStem}.md`, usedPaths);
    chapterMeta.push({ item, html, title: displayTitle, vaultPath });
    chapterPathByZipPath.set(item.fullPath, vaultPath);
  }

  const attachments: EpubPlannedAttachment[] = [];
  const plannedAttachmentByZipPath = new Map<string, string>();
  const chapterNotes: EpubPlannedNote[] = [];

  for (const ch of chapterMeta) {
    const chapterDir = dirnameOfArchive(ch.item.fullPath);
    const md = htmlToMarkdown(ch.html, {
      resolveAssetPath: (rawSrc) => {
        if (/^data:/i.test(rawSrc) || /^[a-z][a-z0-9+.-]*:/i.test(rawSrc)) return null;
        const zipAssetPath = resolveArchiveRelative(chapterDir, rawSrc);
        if (!zipAssetPath) return null;
        const existing = plannedAttachmentByZipPath.get(zipAssetPath);
        if (existing) return existing;
        const assetEntry = lookupZipEntry(input.zipEntries, zipAssetPath);
        if (!assetEntry) return null;
        const baseName = zipAssetPath.split("/").pop() || "image.bin";
        const safeName = baseName.replace(/[\\/:*?"<>|#^[\]]/g, "_");
        const vaultPath = uniqueVaultPath(`${cleanAttachDir}/${bookTitle}/${safeName}`, usedPaths);
        plannedAttachmentByZipPath.set(zipAssetPath, vaultPath);
        attachments.push({ vaultPath, bytes: assetEntry.bytes });
        return vaultPath;
      },
      resolveLinkTarget: (rawHref) => {
        if (/^[a-z][a-z0-9+.-]*:/i.test(rawHref)) return null;
        return chapterPathByZipPath.get(resolveArchiveRelative(chapterDir, rawHref)) ?? null;
      },
    });

    const trimmed = md.trim();
    if (!trimmed) continue;

    const af = computeTopicAFactorFromTextLength(trimmed.length);
    const priority = clampPriority(
      spreadExtractPriority(bookPriority, trimmed.length, input.rng ?? (() => 0.5)),
    );
    const schedule: ReadSchedule = { due: input.now, interval: 0, aFactor: af };
    chapterNotes.push({
      role: "chapter",
      title: ch.title,
      path: ch.vaultPath,
      markdown: trimmed,
      frontmatter: {
        "ir-type": "topic",
        "ir-priority": priority,
        "ir-due": input.now,
        "ir-interval": 0,
        "ir-a-factor": af,
        "ir-parent": bookPath,
      },
      elementId: elementIdForPath(ch.vaultPath),
      parentId: bookElementId,
      priority,
      schedule,
    });
  }

  if (chapterNotes.length === 0) throw new Error("EPUB archive produced no non-empty chapters.");

  const bookLines: string[] = [`# ${bookTitle}`];
  if (opf.author) bookLines.push(`- **Author:** ${opf.author}`);
  if (opf.language) bookLines.push(`- **Language:** ${opf.language}`);
  bookLines.push("", "## Chapters", "");
  for (const ch of chapterNotes) bookLines.push(`- [[${ch.path}|${ch.title}]]`);
  const bookMarkdown = bookLines.join("\n");
  const bookAf = computeTopicAFactorFromTextLength(bookMarkdown.length);

  const bookNote: EpubPlannedNote = {
    role: "book",
    title: bookTitle,
    path: bookPath,
    markdown: bookMarkdown,
    frontmatter: {
      "ir-type": "topic",
      "ir-priority": bookPriority,
      "ir-due": input.now,
      "ir-interval": 0,
      "ir-a-factor": bookAf,
      ...(opf.author ? { author: opf.author } : {}),
      ...(opf.language ? { language: opf.language } : {}),
    },
    elementId: bookElementId,
    parentId: null,
    priority: bookPriority,
    schedule: { due: input.now, interval: 0, aFactor: bookAf },
  };

  const notes = [bookNote, ...chapterNotes];
  const events: IrEvent[] = notes.map((note, idx) => {
    const element: IrElement = {
      ...newElement({
        id: note.elementId,
        type: "topic",
        priority: note.priority,
        parentId: note.parentId,
        notePath: note.path,
        text: "",
        now: input.now,
      }),
      schedule: note.schedule,
    };
    return {
      id: newEventId(),
      ts: input.now,
      lamport: input.now + idx,
      device: input.deviceId,
      kind: "element-created",
      target: note.elementId,
      payload: { element },
    };
  });

  return {
    bookTitle,
    ...(opf.author ? { author: opf.author } : {}),
    ...(opf.language ? { language: opf.language } : {}),
    bookPath,
    notes,
    attachments,
    events,
  };
}

export function planHtmlImport(input: PlanHtmlImportInput): HtmlImportPlan {
  const fileStem = input.fileName.replace(/\.(?:x?html?|htm)$/i, "");
  const extractedTitle =
    firstXmlTagText(input.html, "title") ||
    firstXmlTagText(input.html, "h1") ||
    fileStem ||
    "HTML Import";
  const title = sanitizeStem(extractedTitle, "HTML Import");
  const markdown = htmlToMarkdown(input.html).trim();
  const cleanDir = input.extractFolder.trim().replace(/^\/+|\/+$/g, "");
  const used = new Set<string>(input.existingPaths ?? []);
  const path = uniqueVaultPath(cleanDir ? `${cleanDir}/${title}.md` : `${title}.md`, used);
  const elementId = elementIdForPath(path);
  const priority = clampPriority(input.defaultPriority);
  const af = computeTopicAFactorFromTextLength(markdown.length);
  const schedule: ReadSchedule = { due: input.now, interval: 0, aFactor: af };
  const element: IrElement = {
    ...newElement({
      id: elementId,
      type: "topic",
      priority,
      parentId: null,
      notePath: path,
      text: "",
      now: input.now,
    }),
    schedule,
  };
  return {
    title,
    path,
    markdown,
    frontmatter: {
      "ir-type": "topic",
      "ir-priority": priority,
      "ir-due": input.now,
      "ir-interval": 0,
      "ir-a-factor": af,
    },
    elementId,
    event: {
      id: newEventId(),
      ts: input.now,
      lamport: input.now,
      device: input.deviceId,
      kind: "element-created",
      target: elementId,
      payload: { element },
    },
  };
}
