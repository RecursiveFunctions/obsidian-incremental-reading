import { newElementId, newEventId, type DeviceId, type ElementId } from "./ids";
import { clampPriority, type IrElement, type IrEvent, type IrType, type ReadSchedule, type StoredCard } from "./model";
import type { Bookmark } from "./bookmark";
import { normalizeUrlForDedupe, contentFingerprint } from "./bulk-import";
import { decodeHtmlEntities, htmlToMarkdown as sharedHtmlToMarkdown } from "./html-to-markdown";
import { assertVaultRelativePath, isSafeVaultRelativePath } from "./source-paths";
import {
  parseContents,
  parseElementInfo,
  parseRegistryMem,
  parseRegistryPtr,
  parseRepetitionHistory,
  type ContentsRecord,
  type ElementInfoRecord,
} from "../sm18-format-read";
import { decodeHex, parseSub, real48 } from "../sm18-priority-queue";
import { priorityScaledFirstInterval } from "../topic";
import {
  parseSm20Alg17DatFiles,
  snapshotSm20Matrix,
  type Sm20MatrixSnapshot,
} from "./sm20-matrix";

const MS_PER_DAY = 86_400_000;
const DELPHI_EPOCH_MS = Date.UTC(1899, 11, 30);
const MAX_VALID_EPOCH_MS = 8_640_000_000_000_000;
const COMPON_MARKER = 0xd431;
const COMPON_HEADER_SIZE = 4;
const COMPON_ELEMENT_NUMBER_OFFSET = 4;
const COMPON_COMPONENT_COUNT_OFFSET = 8;
const COMPON_ELEMENT_PARAM_SIZE_OFFSET = 9;
const COMPON_ELEMENT_PARAMETERS_OFFSET = 11;
const COMPON_PARAM_SIZE = 0x2b;
const BINARY_IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;
const TEXT_BACKING_EXT_RE = /\.(?:x?html?|htm|txt)$/i;
const HTML_MARKUP_SNIFF_RE =
  /<\/?(?:html|head|body|div|span|p|br|hr|h[1-6]|b|i|u|s|em|strong|font|a|img|ul|ol|li|dl|dt|dd|table|thead|tbody|tr|th|td|blockquote|pre|code|sup|sub|center|small|big)\b[^>]*>/i;

export const SM_REGISTRY_KINDS = [
  "comment",
  "concept",
  "Font",
  "image",
  "Lexicon",
  "Style",
  "tasklist",
  "template",
  "text",
] as const;

export type SmRegistryKind = (typeof SM_REGISTRY_KINDS)[number];

export interface SmSourceFs {
  listDir(relDir: string): Promise<string[]>;
  readBinary(relPath: string): Promise<Uint8Array | null>;
}

export interface SmComponBookmark {
  readPointStart: number;
  readPointLength: number;
  readPointComponent: number;
  readPointScrollTop: number;
}

export interface SmDecodedComponent {
  componentType: number;
  bounds: [number, number, number, number];
  displayAt: number;
  hyperlink: number;
  registryMember: number;
}

export interface SmDecodedComponRecord {
  elementNumber: number;
  bookmark: SmComponBookmark | null;
  components: SmDecodedComponent[];
}

export interface SmRegistryMember {
  memberNumber: number;
  text: string;
  filespaceSlot: number;
  backingFiles: string[];
}

export interface SmImportedNotePlan {
  smElementNumber: number;
  elementId: ElementId;
  title: string;
  relPath: string;
  markdown: string;
  frontmatter: Record<string, unknown>;
}

export interface SmImportedAttachment {
  sourceRelPath: string;
  targetFileName: string;
  bytes: Uint8Array;
}

export interface SmCollectionImportOptions {
  fs: SmSourceFs;
  nowMs: number;
  deviceId: DeviceId;
  targetFolder: string;
  attachmentFolder?: string;
  existingElements?: ReadonlyMap<ElementId, IrElement>;
  htmlToMarkdown?: (html: string) => string;
  extractCreatesStandaloneNote?: boolean;
}

export interface SmCollectionImportPlan {
  elements: IrElement[];
  events: IrEvent[];
  notes: SmImportedNotePlan[];
  attachments: SmImportedAttachment[];
  bookmarks: Bookmark[];
  sm20Baseline?: Sm20MatrixSnapshot;
  baselineCursorEventId?: string;
  stats: {
    topics: number;
    ledgerExtracts: number;
    noteExtracts: number;
    items: number;
    attachments: number;
    bookmarks: number;
    skippedDeleted: number;
    skippedDuplicates: number;
    historyEvents: number;
  };
}

export function delphiDateToEpochMs(tDateTime: number): number | null {
  if (!Number.isFinite(tDateTime) || tDateTime <= 1) return null;
  const ms = DELPHI_EPOCH_MS + Math.round(tDateTime * MS_PER_DAY);
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_VALID_EPOCH_MS) return null;
  return ms;
}

function decodeWindows1252(bytes: Uint8Array): string {
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) {
      out += String.fromCharCode(bytes[i]!);
    }
    return out;
  }
}

function decodeSmTextBytes(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(3));
  }
  const win = decodeWindows1252(bytes);
  if (/charset\s*=\s*["']?utf-?8/i.test(win.slice(0, 1024))) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  return win;
}

export function defaultHtmlToMarkdown(html: string): string {
  return sharedHtmlToMarkdown(html);
}

/**
 * Normalize an `<img src>` from SuperMemo HTML into a lowercase relative key under `elements/`.
 * Handles `file:///[PrimaryStorage]...`, `[SecondaryStorage]...`, `file:///.../elements/...`,
 * and relative paths like `../10\102.jpg` or `42_files/6081.jpg` without remote scheme literals.
 */
function resolveSmAssetKeyUnderElements(
  rawSrc: string,
  backingDirUnderElements: string,
  filesByRelKey: ReadonlyMap<string, string>,
): string | null {
  let s = rawSrc.trim();
  if (!s) return null;
  const qIdx = s.search(/[?#]/);
  if (qIdx >= 0) s = s.slice(0, qIdx);
  try {
    s = decodeURIComponent(s);
  } catch {
    // Keep raw string when percent-decoding fails
  }
  s = s.replace(/\\/g, "/").trim();
  if (!s) return null;

  if (/^(?:data|blob|javascript|mailto|about):/i.test(s)) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(s);
  if (hasScheme && !/^file:/i.test(s)) return null;

  const normalizeParts = (relCandidate: string): string | null => {
    const stack: string[] = [];
    for (const part of relCandidate.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") {
        if (stack.length === 0) return null;
        stack.pop();
      } else {
        stack.push(part);
      }
    }
    return stack.length > 0 ? stack.join("/").toLowerCase() : null;
  };

  if (hasScheme || /^\[(?:Primary|Secondary)Storage\]/i.test(s)) {
    const strippedFile = s.replace(/^file:\/*/i, "");
    const storageMatch = /^(?:.*\/)?\[(?:Primary|Secondary)Storage\]\/*(.*)$/i.exec(strippedFile);
    if (storageMatch) {
      const key = normalizeParts(storageMatch[1]!);
      return key && filesByRelKey.has(key) ? key : null;
    }
    const lower = strippedFile.toLowerCase();
    const elemMarker = "/elements/";
    const elemIdx = lower.lastIndexOf(elemMarker);
    if (elemIdx >= 0) {
      const key = normalizeParts(strippedFile.slice(elemIdx + elemMarker.length));
      return key && filesByRelKey.has(key) ? key : null;
    }
    return null;
  }

  const combined = backingDirUnderElements ? `${backingDirUnderElements}/${s}` : s;
  const directKey = normalizeParts(combined);
  if (directKey && filesByRelKey.has(directKey)) return directKey;

  // Fallback when relative `../bucket/file` was stored on an element without a nested bucket dir
  const strippedLeadingUp = s.replace(/^(?:\.\.\/)+/, "");
  const fallbackKey = normalizeParts(strippedLeadingUp);
  return fallbackKey && filesByRelKey.has(fallbackKey) ? fallbackKey : null;
}

function sanitizeNoteStem(raw: string, fallback: string): string {
  const cleaned = decodeHtmlEntities(raw)
    .replace(/[\\/:*?"<>|#^[\]\0]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:\.|\s)+|(?:\.|\s)+$/g, "")
    .slice(0, 72)
    .replace(/^(?:\.|\s)+|(?:\.|\s)+$/g, "");
  return cleaned || fallback;
}

/**
 * Rich `info/compon.dat` decoder using byte-level marker resynchronization (`stride = 1`)
 * so SM20 records with under-reported `body_length` never swallow adjacent markers.
 */
export function decodeRichCompon(bytes: Uint8Array): Map<number, SmDecodedComponRecord> {
  const result = new Map<number, SmDecodedComponRecord>();
  if (bytes.byteLength === 0) return result;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;

  while (offset + COMPON_HEADER_SIZE <= bytes.byteLength) {
    if (view.getUint16(offset, true) !== COMPON_MARKER) {
      offset += 1;
      continue;
    }
    const bodyLen = view.getUint16(offset + 2, true);
    const declaredEnd = Math.min(bytes.byteLength, offset + COMPON_HEADER_SIZE + bodyLen);
    let nextMarker = declaredEnd;
    while (nextMarker + 1 < bytes.byteLength && view.getUint16(nextMarker, true) !== COMPON_MARKER) {
      nextMarker += 1;
    }
    if (nextMarker + 1 >= bytes.byteLength) {
      nextMarker = bytes.byteLength;
    }

    if (declaredEnd >= offset + COMPON_ELEMENT_PARAMETERS_OFFSET) {
      const elementNumber = view.getUint32(offset + COMPON_ELEMENT_NUMBER_OFFSET, true);
      const componentCount = view.getUint8(offset + COMPON_COMPONENT_COUNT_OFFSET);
      const paramSize = view.getUint16(offset + COMPON_ELEMENT_PARAM_SIZE_OFFSET, true);
      const paramStart = offset + COMPON_ELEMENT_PARAMETERS_OFFSET;
      const paramEnd = paramStart + paramSize;

      if (paramEnd <= declaredEnd) {
        let bookmark: SmComponBookmark | null = null;
        if (paramSize === COMPON_PARAM_SIZE) {
          const readPointStart = view.getUint32(paramStart + 0x18, true);
          const readPointLength = view.getUint16(paramStart + 0x1c, true);
          const readPointComponent = view.getUint8(paramStart + 0x1e);
          const readPointScrollTop = view.getUint32(paramStart + 0x23, true);
          if (readPointStart > 0 || readPointLength > 0 || readPointScrollTop > 0) {
            bookmark = {
              readPointStart,
              readPointLength,
              readPointComponent,
              readPointScrollTop,
            };
          }
        }

        const components: SmDecodedComponent[] = [];
        let cursor = paramEnd;
        for (let i = 0; i < componentCount && cursor + 3 <= declaredEnd; i += 1) {
          const componentType = view.getUint8(cursor);
          const bufferSize = view.getUint16(cursor + 1, true);
          const bufStart = cursor + 3;
          const bufEnd = bufStart + bufferSize;
          if (bufEnd > declaredEnd) break;
          if (bufferSize >= 0x15) {
            const bounds: [number, number, number, number] = [
              view.getInt16(bufStart + 0x00, true),
              view.getInt16(bufStart + 0x02, true),
              view.getInt16(bufStart + 0x04, true),
              view.getInt16(bufStart + 0x06, true),
            ];
            const displayAt = view.getUint8(bufStart + 0x08);
            const hyperlink = view.getUint32(bufStart + 0x09, true);
            const registryMember = view.getUint32(bufStart + 0x11, true);
            components.push({
              componentType,
              bounds,
              displayAt,
              hyperlink,
              registryMember,
            });
          }
          cursor = bufEnd;
        }

        result.set(elementNumber, { elementNumber, bookmark, components });
      }
    }

    offset = nextMarker > offset ? nextMarker : offset + 1;
  }

  return result;
}

async function findCaseInsensitiveFile(
  fs: SmSourceFs,
  dir: string,
  targetName: string,
): Promise<string | null> {
  const entries = await fs.listDir(dir);
  const want = targetName.toLowerCase();
  for (const entry of entries) {
    const leaf = entry.split("/").pop() ?? entry;
    if (leaf.toLowerCase() === want) {
      return dir ? `${dir}/${leaf}` : leaf;
    }
  }
  return null;
}

async function readCaseInsensitive(
  fs: SmSourceFs,
  dir: string,
  targetName: string,
): Promise<Uint8Array | null> {
  const found = await findCaseInsensitiveFile(fs, dir, targetName);
  if (!found) return null;
  return fs.readBinary(found);
}

/**
 * Resolve a `.ptr` + `.mem` + `.rtx` registry class (and `elements/` filespace slots)
 * using `.ptr` liveness and `.mem` offsets (`0x0a`, `0x0e`, `0x16`), safe against SM20
 * reused `.rtx` free-space pools and `.mem` `0x12` `list_value` pointers.
 */
export async function resolveRichRegistryKind(
  fs: SmSourceFs,
  kind: SmRegistryKind,
  slotToFiles: ReadonlyMap<number, string[]>,
): Promise<Map<number, SmRegistryMember>> {
  const out = new Map<number, SmRegistryMember>();
  const memBytes = await readCaseInsensitive(fs, "registry", `${kind}.mem`);
  const ptrBytes = await readCaseInsensitive(fs, "registry", `${kind}.ptr`);
  const rtxBytes = await readCaseInsensitive(fs, "registry", `${kind}.rtx`);
  if (!memBytes || !rtxBytes) return out;

  const memRecords = parseRegistryMem(memBytes);
  const memView = new DataView(memBytes.buffer, memBytes.byteOffset, memBytes.byteLength);
  const liveMembers = new Set<number>();
  if (ptrBytes) {
    for (const member of parseRegistryPtr(ptrBytes)) {
      if (member > 0 && member <= memRecords.length) liveMembers.add(member);
    }
  } else {
    for (let i = 1; i <= memRecords.length; i += 1) liveMembers.add(i);
  }

  for (const memberNumber of liveMembers) {
    const base = (memberNumber - 1) * 30;
    const position = memView.getUint32(base + 0x0a, true);
    const length = memView.getUint32(base + 0x0e, true);
    const filespaceSlot = memView.getUint32(base + 0x16, true);
    let text = "";
    if (position > 0 && length > 6) {
      const start = position - 1;
      const end = Math.min(rtxBytes.byteLength, start + length - 6);
      if (end > start) {
        text = decodeWindows1252(rtxBytes.subarray(start, end)).replace(/\0+$/g, "");
      }
    }
    const backingFiles = filespaceSlot > 0 ? slotToFiles.get(filespaceSlot) ?? [] : [];
    out.set(memberNumber, { memberNumber, text, filespaceSlot, backingFiles });
  }
  return out;
}

interface ScannedElementsFilespace {
  slotToFiles: Map<number, string[]>;
  filesByRelKey: Map<string, string>;
}

async function scanElementsFilespace(fs: SmSourceFs): Promise<ScannedElementsFilespace> {
  const slotToFiles = new Map<number, string[]>();
  const filesByRelKey = new Map<string, string>();
  const visited = new Set<string>();
  const walk = async (dir: string, depth: number, inAssetSubdir: boolean): Promise<void> => {
    if (depth > 6 || visited.has(dir)) return;
    visited.add(dir);
    const entries = await fs.listDir(dir);
    for (const rawEntry of entries) {
      if (rawEntry.includes("\0") || rawEntry.includes(":")) continue;
      const trimmedEntry = rawEntry.trim();
      if (!trimmedEntry || /^(?:\/|\\)/.test(trimmedEntry)) continue;
      const norm = trimmedEntry.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!norm) continue;
      const normSegs = norm.split("/");
      if (normSegs.some((seg) => !seg || seg === "." || seg === "..")) continue;
      const rel = norm.startsWith(`${dir}/`) ? norm : `${dir}/${norm}`;
      if (!isSafeVaultRelativePath(rel) || !/^elements\//i.test(rel)) continue;
      const rest = rel.slice(dir.length + 1);
      if (!rest) continue;

      // Support both flat-key SmSourceFs implementations (returning full paths under `dir/`)
      // and directory-by-directory `readdir` implementations (returning immediate child entries).
      if (rest.includes("/")) {
        const subSegs = rest.split("/");
        const leaf = subSegs[subSegs.length - 1]!;
        if (!leaf || leaf.toLowerCase().endsWith(".del")) continue;
        const underElements = rel.replace(/^elements\/+/i, "");
        if (underElements) filesByRelKey.set(underElements.toLowerCase(), rel);
        const insideFilesDir = inAssetSubdir || subSegs.slice(0, -1).some((seg) => seg.toLowerCase().endsWith("_files"));
        if (!insideFilesDir) {
          const match = /^(\d+)\.(.+)$/.exec(leaf);
          if (match) {
            const slot = Number.parseInt(match[1]!, 10);
            if (Number.isFinite(slot) && slot > 0) {
              const list = slotToFiles.get(slot);
              if (list) {
                if (!list.includes(rel)) list.push(rel);
              } else {
                slotToFiles.set(slot, [rel]);
              }
            }
          }
        }
        continue;
      }

      const leaf = rest;
      if (leaf.toLowerCase().endsWith(".del")) continue;
      if (/^\d+$/.test(leaf)) {
        await walk(rel, depth + 1, inAssetSubdir);
        continue;
      }
      if (leaf.toLowerCase().endsWith("_files") || (!leaf.includes(".") && inAssetSubdir)) {
        await walk(rel, depth + 1, true);
        continue;
      }
      const underElements = rel.replace(/^elements\/+/i, "");
      if (underElements) filesByRelKey.set(underElements.toLowerCase(), rel);
      if (inAssetSubdir) continue;
      const match = /^(\d+)\.(.+)$/.exec(leaf);
      if (!match) continue;
      const slot = Number.parseInt(match[1]!, 10);
      if (!Number.isFinite(slot) || slot <= 0) continue;
      const list = slotToFiles.get(slot);
      if (list) list.push(rel);
      else slotToFiles.set(slot, [rel]);
    }
  };
  await walk("elements", 0, false);
  return { slotToFiles, filesByRelKey };
}

function synthesizeItemClozeText(texts: Array<{ text: string; displayAt: number }>): string {
  const nonEmpty = texts.filter((t) => t.text.trim().length > 0);
  if (nonEmpty.length === 0) return "";
  if (nonEmpty.length === 1) return nonEmpty[0]!.text.trim();

  const questions = nonEmpty.filter((t) => (t.displayAt & 0x20) !== 0);
  const answers = nonEmpty.filter((t) => (t.displayAt & 0x20) === 0);
  if (questions.length > 0 && answers.length > 0) {
    let qText = questions.map((q) => q.text.trim()).join("\n\n");
    const aText = answers.map((a) => a.text.trim()).join(" / ");
    if (qText.includes("[...]")) {
      let idx = 0;
      qText = qText.replace(/\[\.\.\.\]/g, () => {
        const ans = answers[idx]?.text.trim() ?? aText;
        idx += 1;
        return `{{c1::${ans}}}`;
      });
      return qText;
    }
    return `${qText}\n\n{{c1::${aText}}}`;
  }
  return nonEmpty.map((t) => t.text.trim()).join("\n\n");
}

function smGradeToIrGrade(smGrade: number): number {
  if (smGrade <= 2) return 1;
  if (smGrade === 3) return 2;
  if (smGrade === 4) return 3;
  return 4;
}

export async function planSmCollectionImport(
  opts: SmCollectionImportOptions,
): Promise<SmCollectionImportPlan> {
  const { fs, nowMs, deviceId } = opts;
  const targetFolder = opts.targetFolder.trim().replace(/^\/+|\/+$/g, "");
  const attachmentFolder = (opts.attachmentFolder ?? `${targetFolder}/attachments`).replace(/^\/+|\/+$/g, "");

  const elementInfoBytes = await readCaseInsensitive(fs, "info", "ElementInfo.dat");
  if (!elementInfoBytes) {
    throw new Error("SuperMemo collection missing info/ElementInfo.dat");
  }
  const elementInfos = parseElementInfo(elementInfoBytes);

  const contentsBytes = await readCaseInsensitive(fs, "info", "contents.dat");
  const contentsRecords: ContentsRecord[] = contentsBytes ? parseContents(contentsBytes) : [];

  const componBytes = await readCaseInsensitive(fs, "info", "compon.dat");
  const componByElement = componBytes ? decodeRichCompon(componBytes) : new Map<number, SmDecodedComponRecord>();

  const prioritySubBytes = await readCaseInsensitive(fs, "info", "priority.sub");
  const priorityOrder = prioritySubBytes ? parseSub(prioritySubBytes) : [];
  const priorityPos = new Map<number, number>();
  for (let i = 0; i < priorityOrder.length; i += 1) {
    priorityPos.set(priorityOrder[i]!, i);
  }
  const totalPriorityCount = Math.max(2, priorityOrder.length);

  const repHistoryBytes = await readCaseInsensitive(fs, "info", "RepetitionHistory.dat");
  const repHistory = repHistoryBytes ? parseRepetitionHistory(repHistoryBytes) : [];

  const [
    alg17Sinc,
    alg17SincCases,
    alg17Recall,
    alg17RecallCases,
  ] = await Promise.all([
    readCaseInsensitive(fs, "alg17", "StabilityIncrease.dat"),
    readCaseInsensitive(fs, "alg17", "StabilityIncreaseCases.dat"),
    readCaseInsensitive(fs, "alg17", "Recall.dat"),
    readCaseInsensitive(fs, "alg17", "RecallCases.dat"),
  ]);
  let sm20Baseline: Sm20MatrixSnapshot | undefined;
  if (alg17Sinc && alg17SincCases && alg17Recall && alg17RecallCases) {
    try {
      const parsed = parseSm20Alg17DatFiles({
        sinc: alg17Sinc,
        sincCases: alg17SincCases,
        recall: alg17Recall,
        recallCases: alg17RecallCases,
      });
      sm20Baseline = snapshotSm20Matrix(parsed);
    } catch (e) {
      console.warn("Incremental Reading: could not parse alg17/*.dat SM-20 matrices", e);
    }
  }

  const { slotToFiles, filesByRelKey } = await scanElementsFilespace(fs);
  const textReg = await resolveRichRegistryKind(fs, "text", slotToFiles);
  const imageReg = await resolveRichRegistryKind(fs, "image", slotToFiles);
  const conceptReg = await resolveRichRegistryKind(fs, "concept", slotToFiles);

  // Build duplicate fingerprint index from existing vault elements
  const existingFingerprints = new Set<string>();
  if (opts.existingElements) {
    for (const el of opts.existingElements.values()) {
      if (el.text) existingFingerprints.add(contentFingerprint(el.text));
      const anchorAny = el.anchor as unknown as { url?: unknown } | undefined;
      if (anchorAny && typeof anchorAny.url === "string") {
        const norm = normalizeUrlForDedupe(anchorAny.url);
        if (norm) existingFingerprints.add(`url:${norm}`);
      }
    }
  }

  const smToElementId = new Map<number, ElementId>();
  for (let i = 0; i < elementInfos.length; i += 1) {
    const smId = i + 1;
    const rec = elementInfos[i]!;
    if (rec.element_status === 3) continue;
    smToElementId.set(smId, newElementId());
  }

  const elements: IrElement[] = [];
  const events: IrEvent[] = [];
  const notes: SmImportedNotePlan[] = [];
  const attachments: SmImportedAttachment[] = [];
  const bookmarks: Bookmark[] = [];
  const usedNotePaths = new Set<string>();
  const nextNoteSuffixByStem = new Map<string, number>();
  const copiedAttachmentNames = new Set<string>();
  const nextAttachmentSuffixByStem = new Map<string, number>();
  const attachmentNameBySource = new Map<string, string>();
  const materializedAttachmentSources = new Set<string>();

  const reserveAttachmentFileName = (sourceRelPath: string, preferredName: string): string => {
    const existing = attachmentNameBySource.get(sourceRelPath);
    if (existing) return existing;
    const safePreferred =
      preferredName
        .replace(/[\\/:*?"<>|#^[\]\0]/g, "_")
        .replace(/^(?:\.|\s)+|(?:\.|\s)+$/g, "") || "image.png";
    let candidate = safePreferred;
    if (copiedAttachmentNames.has(candidate)) {
      const dot = safePreferred.lastIndexOf(".");
      const stem = dot > 0 ? safePreferred.slice(0, dot) : safePreferred;
      const ext = dot > 0 ? safePreferred.slice(dot) : "";
      const key = `${stem}\0${ext}`;
      let n = nextAttachmentSuffixByStem.get(key) ?? 2;
      while (copiedAttachmentNames.has(`${stem}-${n}${ext}`)) {
        n += 1;
      }
      nextAttachmentSuffixByStem.set(key, n + 1);
      candidate = `${stem}-${n}${ext}`;
    }
    copiedAttachmentNames.add(candidate);
    attachmentNameBySource.set(sourceRelPath, candidate);
    return candidate;
  };

  const materializeAttachment = async (sourceRelPath: string, targetFileName: string): Promise<boolean> => {
    if (materializedAttachmentSources.has(sourceRelPath)) return true;
    const bytes = await fs.readBinary(sourceRelPath);
    if (!bytes) return false;
    materializedAttachmentSources.add(sourceRelPath);
    assertVaultRelativePath(attachmentFolder ? `${attachmentFolder}/${targetFileName}` : targetFileName);
    attachments.push({ sourceRelPath, targetFileName, bytes });
    stats.attachments += 1;
    return true;
  };

  const convertSmHtml = async (
    rawHtml: string,
    smId: number,
    backingFileRelPath?: string,
  ): Promise<string> => {
    if (opts.htmlToMarkdown) {
      return opts.htmlToMarkdown(rawHtml);
    }
    let backingDirUnderElements = "";
    if (backingFileRelPath) {
      const under = backingFileRelPath.replace(/\\/g, "/").replace(/^elements\/+/i, "");
      const slash = under.lastIndexOf("/");
      backingDirUnderElements = slash > 0 ? under.slice(0, slash) : "";
    }
    const newlyReferenced = new Map<string, string>();
    const md = sharedHtmlToMarkdown(rawHtml, {
      resolveAssetPath: (rawSrc) => {
        const relKey = resolveSmAssetKeyUnderElements(rawSrc, backingDirUnderElements, filesByRelKey);
        if (!relKey) return null;
        const sourceRelPath = filesByRelKey.get(relKey);
        if (!sourceRelPath || !BINARY_IMAGE_EXT_RE.test(sourceRelPath)) return null;
        const leaf = sourceRelPath.split("/").pop() ?? `asset-${smId}.png`;
        const targetFileName = reserveAttachmentFileName(sourceRelPath, `sm-asset-${leaf}`);
        newlyReferenced.set(sourceRelPath, targetFileName);
        return attachmentFolder ? `${attachmentFolder}/${targetFileName}` : targetFileName;
      },
    });
    let finalMd = md;
    for (const [sourceRelPath, targetFileName] of newlyReferenced) {
      const ok = await materializeAttachment(sourceRelPath, targetFileName);
      if (!ok) {
        const embedPath = attachmentFolder ? `${attachmentFolder}/${targetFileName}` : targetFileName;
        finalMd = finalMd.split(`![[${embedPath}]]`).join("").replace(/\n{3,}/g, "\n\n").trim();
      }
    }
    return finalMd;
  };

  const resolveTextMemberMarkdown = async (
    txtMember: SmRegistryMember | undefined,
    smId: number,
    forceHtml: boolean,
  ): Promise<string> => {
    if (!txtMember) return "";
    let rawText = "";
    let backingFileUsed: string | undefined;
    const textBacking = txtMember.backingFiles.find((f) => TEXT_BACKING_EXT_RE.test(f));
    if (textBacking) {
      const rawFile = await fs.readBinary(textBacking);
      if (rawFile) {
        rawText = decodeSmTextBytes(rawFile);
        backingFileUsed = textBacking;
      }
    }
    if (!rawText) {
      rawText = txtMember.text;
    }
    if (!rawText) return "";
    const isHtmlBacking = Boolean(backingFileUsed && /\.x?html?$/i.test(backingFileUsed));
    const isPlainTxtBacking = Boolean(backingFileUsed && /\.txt$/i.test(backingFileUsed));
    return forceHtml || isHtmlBacking || (!isPlainTxtBacking && HTML_MARKUP_SNIFF_RE.test(rawText))
      ? await convertSmHtml(rawText, smId, backingFileUsed)
      : rawText.trim();
  };

  const stats = {
    topics: 0,
    ledgerExtracts: 0,
    noteExtracts: 0,
    items: 0,
    attachments: 0,
    bookmarks: 0,
    skippedDeleted: 0,
    skippedDuplicates: 0,
    historyEvents: 0,
  };

  let lamport = nowMs;

  for (let i = 0; i < elementInfos.length; i += 1) {
    const smId = i + 1;
    const rec: ElementInfoRecord = elementInfos[i]!;
    if (rec.element_status === 3) {
      stats.skippedDeleted += 1;
      continue;
    }
    const elementId = smToElementId.get(smId)!;
    const contents = contentsRecords[i];
    const parentSmId = contents && contents.unknown_0x00 === 0 ? contents.unknown_0x01 : 0;
    const parentId = parentSmId > 0 ? smToElementId.get(parentSmId) ?? null : null;

    const pos = priorityPos.get(smId);
    const priority = clampPriority(
      pos !== undefined ? (pos / (totalPriorityCount - 1)) * 100 : 33,
    );

    const isItem = rec.element_type === 1;
    const isExtract = !isItem && rec.source_article !== 0;
    const irType: IrType = isItem ? "item" : isExtract ? "extract" : "topic";

    const compon = componByElement.get(smId);
    const textParts: Array<{ text: string; displayAt: number }> = [];
    const imageLinks: string[] = [];
    const seenTextMembers = new Set<number>();

    if (compon) {
      for (const comp of compon.components) {
        if (comp.componentType === 2 && comp.registryMember > 0) {
          const imgMember = imageReg.get(comp.registryMember);
          if (imgMember) {
            for (const relPath of imgMember.backingFiles) {
              if (!BINARY_IMAGE_EXT_RE.test(relPath)) continue;
              const ext = (relPath.split(".").pop() ?? "png").toLowerCase();
              const targetFileName = reserveAttachmentFileName(
                relPath,
                `sm-${smId}-${comp.registryMember}.${ext}`,
              );
              const ok = await materializeAttachment(relPath, targetFileName);
              if (!ok) continue;
              const embedPath = attachmentFolder ? `${attachmentFolder}/${targetFileName}` : targetFileName;
              imageLinks.push(`![[${embedPath}]]`);
            }
          }
        } else if (
          (comp.componentType === 0 ||
            comp.componentType === 1 ||
            comp.componentType === 13 ||
            comp.componentType === 16) &&
          comp.registryMember > 0
        ) {
          seenTextMembers.add(comp.registryMember);
          const txtMember = textReg.get(comp.registryMember);
          const md = await resolveTextMemberMarkdown(
            txtMember,
            smId,
            comp.componentType === 13 || comp.componentType === 16,
          );
          if (md) textParts.push({ text: md, displayAt: comp.displayAt });
        }
      }
    }

    if (textParts.length === 0 && rec.text_registry_member > 0 && !seenTextMembers.has(rec.text_registry_member)) {
      const txtMember = textReg.get(rec.text_registry_member);
      const md = await resolveTextMemberMarkdown(txtMember, smId, false);
      if (md) textParts.push({ text: md, displayAt: 0xff });
    }

    const titleText = textReg.get(rec.text_registry_member)?.text?.trim() || `SM Element ${smId}`;
    let bodyText =
      irType === "item"
        ? synthesizeItemClozeText(textParts)
        : textParts.map((p) => p.text).join("\n\n").trim();
    if (imageLinks.length > 0) {
      bodyText = bodyText ? `${bodyText}\n\n${imageLinks.join("\n")}` : imageLinks.join("\n");
    }
    if (!bodyText) bodyText = titleText;

    const fp = contentFingerprint(bodyText);
    if (existingFingerprints.has(fp)) {
      stats.skippedDuplicates += 1;
      continue;
    }
    existingFingerprints.add(fp);

    const aFactorRaw = real48(decodeHex(rec.a_factor.hex));
    const aFactor = Number.isFinite(aFactorRaw) && aFactorRaw >= 1.01 && aFactorRaw <= 10 ? aFactorRaw : 2.0;
    const diffRaw = real48(decodeHex(rec.difficulty.hex));
    const difficulty = Number.isFinite(diffRaw) && diffRaw >= 0 && diffRaw <= 1 ? 1 + diffRaw * 9 : 5.0;

    const lastRepMs = delphiDateToEpochMs(rec.last_repetition_date);
    let dueMs: number;
    if (rec.element_status === 1) {
      const baseMs = lastRepMs ?? nowMs;
      const rawDue = baseMs + Math.max(1, rec.interval_days) * MS_PER_DAY;
      dueMs = Number.isFinite(rawDue) && Math.abs(rawDue) <= MAX_VALID_EPOCH_MS ? rawDue : nowMs;
    } else if (rec.element_status === 0) {
      const staggeredDays = priorityScaledFirstInterval(priority, totalPriorityCount, 1);
      const rawDue = nowMs + staggeredDays * MS_PER_DAY;
      dueMs = Number.isFinite(rawDue) && Math.abs(rawDue) <= MAX_VALID_EPOCH_MS ? rawDue : nowMs;
    } else {
      dueMs = nowMs;
    }

    const dismissed = rec.element_status === 2;
    const schedule: ReadSchedule | undefined =
      irType !== "item"
        ? { due: dueMs, interval: rec.interval_days, aFactor }
        : undefined;
    const card: StoredCard | undefined =
      irType === "item"
        ? {
            due: dueMs,
            stability: Math.max(0.7, rec.interval_days || 1),
            difficulty,
            elapsedDays: 0,
            scheduledDays: rec.interval_days,
            reps: rec.repetition_count,
            lapses: rec.lapse_count,
            state: rec.repetition_count > 0 ? 2 : 0,
            learningSteps: 0,
            ...(lastRepMs !== null ? { lastReview: lastRepMs } : {}),
          }
        : undefined;

    const shouldWriteNote =
      irType !== "extract" || imageLinks.length > 0 || Boolean(opts.extractCreatesStandaloneNote);
    let notePath: string | undefined;
    if (shouldWriteNote) {
      const stem = sanitizeNoteStem(titleText, `sm-${smId}`);
      const dirPrefix = targetFolder ? `${targetFolder}/` : "";
      const baseStem = `${dirPrefix}${stem}`;
      const nextSuffix = nextNoteSuffixByStem.get(baseStem);
      let candidate: string;
      if (nextSuffix === undefined) {
        candidate = `${baseStem}.md`;
        if (usedNotePaths.has(candidate)) {
          let suffix = 2;
          while (usedNotePaths.has(`${baseStem} ${suffix}.md`)) {
            suffix += 1;
          }
          nextNoteSuffixByStem.set(baseStem, suffix + 1);
          candidate = `${baseStem} ${suffix}.md`;
        } else {
          nextNoteSuffixByStem.set(baseStem, 2);
        }
      } else {
        let suffix = nextSuffix;
        while (usedNotePaths.has(`${baseStem} ${suffix}.md`)) {
          suffix += 1;
        }
        nextNoteSuffixByStem.set(baseStem, suffix + 1);
        candidate = `${baseStem} ${suffix}.md`;
      }
      usedNotePaths.add(assertVaultRelativePath(candidate));
      notePath = candidate;

      const conceptTag = rec.concept_group_member > 0
        ? conceptReg.get(rec.concept_group_member)?.text?.trim()
        : undefined;
      const frontmatter: Record<string, unknown> = {
        "ir-type": irType,
        "ir-priority": Math.round(priority * 100) / 100,
        "ir-due": dueMs,
        ...(conceptTag ? { tags: [conceptTag.replace(/\s+/g, "-")] } : {}),
      };
      notes.push({
        smElementNumber: smId,
        elementId,
        title: stem,
        relPath: candidate,
        markdown: bodyText,
        frontmatter,
      });
    }

    if (irType === "topic") stats.topics += 1;
    else if (irType === "item") stats.items += 1;
    else if (notePath) stats.noteExtracts += 1;
    else stats.ledgerExtracts += 1;

    const createdMs = delphiDateToEpochMs(rec.extraction_date) ?? nowMs;
    const element: IrElement = {
      id: elementId,
      type: irType,
      priority,
      parentId,
      dismissed,
      created: createdMs,
      text: bodyText,
      anchorState: "ok",
      ...(notePath ? { notePath } : {}),
      ...(schedule ? { schedule } : {}),
      ...(card ? { card } : {}),
    };
    elements.push(element);
    events.push({
      id: newEventId(),
      ts: nowMs,
      lamport: lamport++,
      device: deviceId,
      kind: "element-created",
      target: elementId,
      payload: { element },
    });

    if (compon?.bookmark) {
      bookmarks.push({
        elementId,
        line: 0,
        ch: compon.bookmark.readPointStart,
        scrollTop: compon.bookmark.readPointScrollTop,
        updatedAt: nowMs,
      });
      stats.bookmarks += 1;
    }
  }

  // Translate item RepetitionHistory.dat rows (valid SM grades 0..5) into graded ledger events
  // without clobbering authoritative ElementInfo.dat card state on the final event.
  const elementById = new Map<ElementId, IrElement>(elements.map((e) => [e.id, e]));
  const repHistoryView =
    repHistoryBytes && repHistoryBytes.byteLength >= 39
      ? new DataView(repHistoryBytes.buffer, repHistoryBytes.byteOffset, repHistoryBytes.byteLength)
      : null;

  interface IndexedRepRow {
    rowIndex: number;
    rep: (typeof repHistory)[number];
    repMs: number;
    rawDifficultyI16: number;
  }

  const historyByElement = new Map<ElementId, IndexedRepRow[]>();
  for (let rowIndex = 0; rowIndex < repHistory.length; rowIndex += 1) {
    const rep = repHistory[rowIndex]!;
    if (rep.grade < 0 || rep.grade > 5) continue;
    const elementId = smToElementId.get(rep.element_id);
    if (!elementId) continue;
    const targetEl = elementById.get(elementId);
    if (!targetEl || targetEl.type !== "item") continue;
    const repMs = delphiDateToEpochMs(rep.repetition_date);
    if (repMs === null) continue;
    const rawDifficultyI16 = repHistoryView
      ? repHistoryView.getInt16(rowIndex * 39 + 0x19, true)
      : -1;
    const list = historyByElement.get(elementId);
    const entry: IndexedRepRow = { rowIndex, rep, repMs, rawDifficultyI16 };
    if (list) list.push(entry);
    else historyByElement.set(elementId, [entry]);
  }

  let lastHistoryEventId: string | undefined;
  for (const [elementId, rows] of historyByElement) {
    const targetEl = elementById.get(elementId)!;
    const authoritativeCard = targetEl.card;
    rows.sort((a, b) => a.repMs - b.repMs || a.rep.repetition_number - b.rep.repetition_number || a.rowIndex - b.rowIndex);

    for (let idx = 0; idx < rows.length; idx += 1) {
      const { rep, repMs, rawDifficultyI16 } = rows[idx]!;
      const prevRow = idx > 0 ? rows[idx - 1] : undefined;
      const nextRow = idx + 1 < rows.length ? rows[idx + 1] : undefined;
      const isFinal = idx === rows.length - 1;

      const histDifficulty =
        rawDifficultyI16 >= 0 && rawDifficultyI16 <= 10_000
          ? 1 + (rawDifficultyI16 / 10_000) * 9
          : (authoritativeCard?.difficulty ?? 5.0);
      const elapsedDays = prevRow
        ? Math.max(0, Math.floor((repMs - prevRow.repMs) / MS_PER_DAY))
        : Math.max(0, rep.interval_days);
      const nextScheduledDays = nextRow
        ? Math.max(1, Math.round((nextRow.repMs - repMs) / MS_PER_DAY))
        : Math.max(1, authoritativeCard?.scheduledDays || rep.interval_days || 1);

      const card: StoredCard = isFinal && authoritativeCard
        ? {
            ...authoritativeCard,
            elapsedDays,
            lastReview: authoritativeCard.lastReview ?? repMs,
          }
        : {
            due: Math.min(MAX_VALID_EPOCH_MS, repMs + nextScheduledDays * MS_PER_DAY),
            stability: Math.max(0.7, nextScheduledDays),
            difficulty: histDifficulty,
            elapsedDays,
            scheduledDays: nextScheduledDays,
            reps: rep.repetition_number,
            lapses: rep.lapse_count,
            state: 2,
            learningSteps: 0,
            lastReview: repMs,
          };

      const evId = newEventId();
      events.push({
        id: evId,
        ts: repMs,
        lamport: lamport++,
        device: deviceId,
        kind: "graded",
        target: elementId,
        payload: {
          card,
          grade: smGradeToIrGrade(rep.grade),
          smGrade: rep.grade,
          scheduler: "sm20",
        },
      });
      lastHistoryEventId = evId;
      stats.historyEvents += 1;
    }
  }

  const baselineCursorEventId = sm20Baseline
    ? (lastHistoryEventId ?? events[events.length - 1]?.id)
    : undefined;

  return {
    elements,
    events,
    notes,
    attachments,
    bookmarks,
    ...(sm20Baseline ? { sm20Baseline } : {}),
    ...(baselineCursorEventId ? { baselineCursorEventId } : {}),
    stats,
  };
}
