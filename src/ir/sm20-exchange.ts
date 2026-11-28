/**
 * SuperMemo 20 Exchange Formats (`~/code/sm20-re` Pillar D2):
 * - SuperMemo Q&A Text (`TImportTXTDlg` `0x00c435f0`) import & export
 * - SuperMemo XML Collection (`ImportElementFromXmlNode` `0x00c3bf30`) import & export
 * - Binary SM18/SM20 Collection Package export (`ElementInfo.dat`, `contents.dat`,
 *   `priority.sub`, `registry/concept.dat` 65 B stride, and all 8 `alg17/*.dat` matrices)
 */

import { clozeAnswersInline, listClozeGroups, wrapCloze } from "../cloze";
import {
  writeContents,
  writeElementInfo,
  writeSub,
  type ContentsRecord,
  type ElementInfoRecord,
} from "../sm18-format-write";
import {
  formatSuperMemoReferenceFooter,
  parseSuperMemoReferenceFooter,
  slugifyConceptId,
  stripSuperMemoReferenceFooter,
  type ConceptGroup,
} from "./concepts-references";
import { newElementId, newEventId, type DeviceId, type ElementId } from "./ids";
import { htmlToMarkdown, stripRemoteMarkdownImages } from "./html-to-markdown";
import { extractTypedClozes, hasTypedCloze } from "./interactive-items";
import {
  clampPriority,
  newElement,
  type IrElement,
  type IrEvent,
  type IrType,
} from "./model";
import { createEmptySm20Matrix, encodeSm20Alg17DatFiles, type Sm20Matrix } from "./sm20-matrix";
import { formatLocalDateMs } from "./stats";
import { storedDifficultyTo01 } from "./sm20-scheduler";

const MS_PER_DAY = 86_400_000;
const DELPHI_EPOCH_MS = Date.UTC(1899, 11, 30);
const REAL48_BIAS = 129;
const REAL48_MANTISSA_SCALE = Math.pow(2, 39);
const MAX_EXCHANGE_CHARS = 32 * 1024 * 1024;
const MAX_XML_NESTING_DEPTH = 64;
const MAX_EXCHANGE_ELEMENTS = 50_000;
const HTML_TAG_DETECT_RE = /<[a-z!/][^>]*>/i;

function sanitizeImportedRichText(raw: string): string {
  const clean = raw.replace(/\0/g, "");
  if (!HTML_TAG_DETECT_RE.test(clean)) return stripRemoteMarkdownImages(clean);
  return htmlToMarkdown(clean);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// --- 1. SuperMemo Q&A Text (`0x00c435f0`) -----------------------------------

export interface QaImportResult {
  elements: IrElement[];
  events: IrEvent[];
}

/**
 * Parses SuperMemo Q&A text (`Q: ... \n A: ...` blocks separated by blank lines,
 * supporting inline `[answer]` brackets in `Q:` and `#SuperMemo Reference:` footers).
 */
export function parseSuperMemoQaText(
  rawText: string,
  nowMs: number,
  deviceId: DeviceId,
  defaultPriority = 33,
): QaImportResult {
  if (rawText.length > MAX_EXCHANGE_CHARS) {
    throw new Error("Q&A import exceeds maximum allowed size (32 MB)");
  }
  const blocks = rawText
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const elements: IrElement[] = [];
  const events: IrEvent[] = [];
  let lamport = 1;

  for (const block of blocks) {
    if (elements.length >= MAX_EXCHANGE_ELEMENTS) break;
    const ref = parseSuperMemoReferenceFooter(block);
    const cleanedBlock = stripSuperMemoReferenceFooter(block);
    const lines = cleanedBlock.split("\n");
    const qLines: string[] = [];
    const aLines: string[] = [];
    let mode: "none" | "q" | "a" = "none";

    for (const rawLine of lines) {
      const qMatch = /^Q:\s*(.*)$/i.exec(rawLine);
      if (qMatch) {
        mode = "q";
        if (qMatch[1]) qLines.push(qMatch[1]);
        continue;
      }
      const aMatch = /^A:\s*(.*)$/i.exec(rawLine);
      if (aMatch) {
        mode = "a";
        if (aMatch[1]) aLines.push(aMatch[1]);
        continue;
      }
      if (mode === "q") qLines.push(rawLine);
      else if (mode === "a") aLines.push(rawLine);
    }

    const question = sanitizeImportedRichText(qLines.join("\n").trim());
    const answer = sanitizeImportedRichText(aLines.join("\n").trim());
    if (!question && !answer) continue;

    let itemText: string;
    const inlineBracket = /\[([^\][]+)\]/.exec(question);
    if (inlineBracket && (!answer || inlineBracket[1]!.trim() === answer || inlineBracket[1]!.trim() === "...")) {
      const ans = answer || inlineBracket[1]!.trim();
      itemText = question.replace(inlineBracket[0], wrapCloze(ans, 1));
    } else if (answer) {
      itemText = `${question}\n\n${wrapCloze(answer, 1)}`;
    } else {
      continue;
    }

    const id = newElementId();
    const el: IrElement = {
      ...newElement({ id, type: "item", priority: defaultPriority, text: itemText, now: nowMs }),
      ...(ref ? { reference: ref } : {}),
      card: {
        due: nowMs,
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 0,
        reps: 0,
        lapses: 0,
        state: 0,
      },
    };
    elements.push(el);
    events.push({
      id: newEventId(),
      ts: nowMs,
      lamport: lamport++,
      device: deviceId,
      kind: "element-created",
      target: id,
      payload: { element: el },
    });
  }

  return { elements, events };
}

export function exportSuperMemoQaText(elements: Iterable<IrElement>): string {
  const blocks: string[] = [];
  for (const el of elements) {
    if (el.dismissed || el.type !== "item") continue;
    const typedGroups = hasTypedCloze(el.text) ? extractTypedClozes(el.text) : [];
    const stdGroups = listClozeGroups(el.text);
    const firstAns = typedGroups[0]?.answer ?? stdGroups[0]?.answer;
    if (!firstAns) continue;

    let qText = el.text
      .replace(/\{\{c\d+:=[\s\S]*?\}\}/g, "[...]")
      .replace(/\{\{c\d+::[\s\S]*?\}\}/g, "[...]")
      .trim();
    // If question ended with standalone `[...]` on its own paragraph, strip trailing `[...]`
    const standaloneTrail = /\n\n\[\.\.\.\]$/;
    if (standaloneTrail.test(qText)) {
      qText = qText.replace(standaloneTrail, "").trim();
    }
    const lines = [`Q: ${qText}`, `A: ${firstAns}`];
    if (el.reference) {
      const footer = formatSuperMemoReferenceFooter(el.reference);
      if (footer) lines.push(footer);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n") + (blocks.length > 0 ? "\n" : "");
}

// --- 2. SuperMemo XML Collection (`0x00c3bf30`) -----------------------------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function readDirectXmlTag(xmlChunk: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = re.exec(xmlChunk);
  return m ? xmlUnescape(m[1]!.trim()) : null;
}

/**
 * Parse an exchange-file date field. A bare `YYYY-MM-DD` value denotes a
 * calendar day in the author's timezone, so read it as local midnight —
 * `Date.parse` would treat it as UTC midnight, shifting the day for every
 * non-UTC user (#137 family). Full ISO timestamps keep `Date.parse` semantics.
 */
function parseExchangeDateMs(raw: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return Date.parse(raw);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

interface ParsedXmlNode {
  headerXml: string;
  children: ParsedXmlNode[];
}

/**
 * Balanced `<SuperMemoElement>` tree scanner so nested child elements never
 * bleed into parent `<Content>` or `<LearningData>` tags.
 */
function scanSuperMemoXmlElements(xml: string): ParsedXmlNode[] {
  const openTag = "<SuperMemoElement>";
  const closeTag = "</SuperMemoElement>";
  const roots: ParsedXmlNode[] = [];
  const stack: Array<{ startInner: number; childRanges: Array<[number, number]>; children: ParsedXmlNode[] }> = [];

  let pos = 0;
  while (pos < xml.length) {
    const nextOpen = xml.indexOf(openTag, pos);
    const nextClose = xml.indexOf(closeTag, pos);
    if (nextOpen === -1 && nextClose === -1) break;

    if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
      stack.push({ startInner: nextOpen + openTag.length, childRanges: [], children: [] });
      pos = nextOpen + openTag.length;
    } else {
      const top = stack.pop();
      const endOuter = nextClose + closeTag.length;
      if (top) {
        let headerXml = "";
        let cursor = top.startInner;
        for (const [cStart, cEnd] of top.childRanges) {
          headerXml += xml.slice(cursor, cStart);
          cursor = cEnd;
        }
        headerXml += xml.slice(cursor, nextClose);
        const node: ParsedXmlNode = { headerXml, children: top.children };
        if (stack.length > 0) {
          const parent = stack[stack.length - 1]!;
          parent.childRanges.push([top.startInner - openTag.length, endOuter]);
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      }
      pos = endOuter;
    }
  }
  return roots;
}

export interface SmXmlImportResult {
  elements: IrElement[];
  events: IrEvent[];
  concepts: ConceptGroup[];
}

export function parseSuperMemoXmlCollection(
  xmlText: string,
  nowMs: number,
  deviceId: DeviceId,
): SmXmlImportResult {
  if (xmlText.length > MAX_EXCHANGE_CHARS) {
    throw new Error("SuperMemo XML import exceeds maximum allowed size (32 MB)");
  }
  const tree = scanSuperMemoXmlElements(xmlText);
  const elements: IrElement[] = [];
  const events: IrEvent[] = [];
  const conceptsById = new Map<string, ConceptGroup>();
  let lamport = 1;

  const workStack: Array<{ node: ParsedXmlNode; parentId: ElementId | null; depth: number }> = [];
  for (let i = tree.length - 1; i >= 0; i -= 1) {
    workStack.push({ node: tree[i]!, parentId: null, depth: 1 });
  }

  while (workStack.length > 0 && elements.length < MAX_EXCHANGE_ELEMENTS) {
    const { node, parentId, depth } = workStack.pop()!;
    if (depth > MAX_XML_NESTING_DEPTH) continue;

    const hdr = node.headerXml;
    const rawType = (readDirectXmlTag(hdr, "Type") ?? "Topic").toLowerCase();
    const irType: IrType =
      rawType === "item" ? "item" : parentId !== null && rawType === "extract" ? "extract" : "topic";

    const title = sanitizeImportedRichText(readDirectXmlTag(hdr, "Title") ?? "");
    const contentChunk = readDirectXmlTag(hdr, "Content") ?? hdr;
    const rawQuestion = readDirectXmlTag(hdr, "Question") ?? readDirectXmlTag(contentChunk, "Question") ?? "";
    const rawAnswer = readDirectXmlTag(hdr, "Answer") ?? readDirectXmlTag(contentChunk, "Answer") ?? "";

    const combinedRaw = [rawQuestion, rawAnswer].filter(Boolean).join("\n\n") || title;
    const ref = parseSuperMemoReferenceFooter(combinedRaw);
    const cleanQ = sanitizeImportedRichText(stripSuperMemoReferenceFooter(rawQuestion));
    const cleanA = sanitizeImportedRichText(stripSuperMemoReferenceFooter(rawAnswer));

    let bodyText: string;
    if (irType === "item") {
      if (/\{\{c\d+(?:::|:=)/.test(cleanQ)) {
        bodyText = cleanQ;
      } else if (cleanA) {
        bodyText = cleanQ ? `${cleanQ}\n\n${wrapCloze(cleanA, 1)}` : wrapCloze(cleanA, 1);
      } else {
        bodyText = cleanQ || title;
      }
    } else {
      bodyText = [cleanQ, cleanA].filter(Boolean).join("\n\n").trim() || title;
    }

    const prioNum = Number(readDirectXmlTag(hdr, "Priority"));
    const priority = clampPriority(Number.isFinite(prioNum) ? prioNum : 33);
    const conceptName = readDirectXmlTag(hdr, "ConceptGroup");
    const id = newElementId();
    let conceptId: string | undefined;
    if (conceptName) {
      conceptId = slugifyConceptId(conceptName);
      if (!conceptsById.has(conceptId)) {
        conceptsById.set(conceptId, {
          id: conceptId,
          name: conceptName.slice(0, 200),
          rootElementId: parentId === null ? id : undefined,
          defaultPriority: priority,
          updatedAt: nowMs,
        });
      }
    }

    const ivl = Math.max(0, Math.round(Number(readDirectXmlTag(hdr, "Interval")) || 0));
    const reps = Math.max(0, Math.round(Number(readDirectXmlTag(hdr, "Repetitions")) || 0));
    const lapses = Math.max(0, Math.round(Number(readDirectXmlTag(hdr, "Lapses")) || 0));
    const aFactorRaw = Number(readDirectXmlTag(hdr, "AFactor"));
    const aFactor = Number.isFinite(aFactorRaw) && aFactorRaw >= 1.01 ? aFactorRaw : 2.0;
    const uFactorRaw = Number(readDirectXmlTag(hdr, "UFactor"));
    const lastRepStr = readDirectXmlTag(hdr, "LastRepetition");
    const parsedLastMs = lastRepStr ? parseExchangeDateMs(lastRepStr) : NaN;
    const lastRevMs = Number.isFinite(parsedLastMs) ? parsedLastMs : nowMs;
    const dueMs = reps > 0 && ivl > 0 ? lastRevMs + ivl * MS_PER_DAY : nowMs + Math.max(1, ivl) * MS_PER_DAY;

    const el: IrElement = {
      ...newElement({ id, type: irType, priority, parentId, text: bodyText, now: nowMs }),
      ...(conceptId ? { conceptId } : {}),
      ...(ref ? { reference: ref } : {}),
      ...(irType === "item"
        ? {
            card: {
              due: dueMs,
              stability: Math.max(0.7, ivl || 1),
              difficulty: Number.isFinite(uFactorRaw) && uFactorRaw > 0
                ? clamp(10 - (uFactorRaw - 1) * 2, 1, 10)
                : 5,
              elapsedDays: 0,
              scheduledDays: ivl,
              reps,
              lapses,
              state: reps > 0 ? 2 : 0,
              ...(reps > 0 ? { lastReview: lastRevMs } : {}),
            },
          }
        : {
            schedule: {
              due: dueMs,
              interval: Math.max(1, ivl || 1),
              aFactor,
            },
          }),
    };

    elements.push(el);
    events.push({
      id: newEventId(),
      ts: nowMs,
      lamport: lamport++,
      device: deviceId,
      kind: "element-created",
      target: id,
      payload: { element: el },
    });

    if (depth < MAX_XML_NESTING_DEPTH) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) {
        workStack.push({ node: node.children[i]!, parentId: id, depth: depth + 1 });
      }
    }
  }

  return {
    elements,
    events,
    concepts: [...conceptsById.values()],
  };
}

export function exportSuperMemoXmlCollection(
  elements: Iterable<IrElement>,
  concepts: readonly ConceptGroup[] = [],
  nowMs = Date.now(),
): string {
  const list = Array.from(elements).filter((e) => !e.dismissed);
  const byParent = new Map<string | null, IrElement[]>();
  const validIds = new Set(list.map((e) => e.id));
  for (const el of list) {
    const pKey = el.parentId && validIds.has(el.parentId) ? el.parentId : null;
    const arr = byParent.get(pKey) ?? [];
    arr.push(el);
    byParent.set(pKey, arr);
  }
  const conceptNameById = new Map(concepts.map((c) => [c.id, c.name]));

  let nextSmId = 1;
  const renderNode = (el: IrElement, indent: string): string => {
    const smId = nextSmId++;
    const smType = el.type === "item" ? "Item" : "Topic";
    const firstLine = clozeAnswersInline(el.text).split("\n")[0]?.trim().slice(0, 80) || `${smType} ${smId}`;
    const refFooter = el.reference ? `\n\n${formatSuperMemoReferenceFooter(el.reference)}` : "";

    let questionText = el.text;
    let answerText = "";
    if (el.type === "item") {
      const groups = listClozeGroups(el.text);
      const typed = hasTypedCloze(el.text) ? extractTypedClozes(el.text) : [];
      answerText = typed[0]?.answer ?? groups[0]?.answer ?? "";
      questionText = el.text
        .replace(/\{\{c\d+:=[\s\S]*?\}\}/g, "[...]")
        .replace(/\{\{c\d+::[\s\S]*?\}\}/g, "[...]")
        .replace(/\n\n\[\.\.\.\]$/, "")
        .trim();
    }
    questionText = `${questionText}${refFooter}`.trim();

    const ivl = el.type === "item" ? (el.card?.scheduledDays ?? 0) : Math.round(el.schedule?.interval ?? 1);
    const reps = el.type === "item" ? (el.card?.reps ?? 0) : 1;
    const lapses = el.type === "item" ? (el.card?.lapses ?? 0) : 0;
    const aFactor = el.type === "item" ? 1.5 : (el.schedule?.aFactor ?? 2.0);
    const lastMs = el.type === "item" ? (el.card?.lastReview ?? nowMs) : nowMs;
    const lastDateStr = formatLocalDateMs(lastMs);
    const cName = el.conceptId ? (conceptNameById.get(el.conceptId) ?? el.conceptId) : null;

    const lines = [
      `${indent}<SuperMemoElement>`,
      `${indent}  <ID>${smId}</ID>`,
      `${indent}  <Title>${xmlEscape(firstLine)}</Title>`,
      `${indent}  <Type>${smType}</Type>`,
      ...(cName ? [`${indent}  <ConceptGroup>${xmlEscape(cName)}</ConceptGroup>`] : []),
      `${indent}  <Content>`,
      `${indent}    <Question>${xmlEscape(questionText)}</Question>`,
      ...(answerText ? [`${indent}    <Answer>${xmlEscape(answerText)}</Answer>`] : []),
      `${indent}  </Content>`,
      `${indent}  <LearningData>`,
      `${indent}    <Interval>${ivl}</Interval>`,
      `${indent}    <Repetitions>${reps}</Repetitions>`,
      `${indent}    <Lapses>${lapses}</Lapses>`,
      `${indent}    <AFactor>${aFactor.toFixed(3)}</AFactor>`,
      `${indent}    <Priority>${el.priority.toFixed(2)}</Priority>`,
      `${indent}    <LastRepetition>${lastDateStr}</LastRepetition>`,
      `${indent}  </LearningData>`,
    ];

    const kids = byParent.get(el.id) ?? [];
    for (const k of kids) {
      lines.push(renderNode(k, `${indent}  `));
    }
    lines.push(`${indent}</SuperMemoElement>`);
    return lines.join("\n");
  };

  const roots = byParent.get(null) ?? [];
  const body = roots.map((r) => renderNode(r, "  ")).join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<SuperMemoCollection>",
    `  <Count>${list.length}</Count>`,
    body,
    "</SuperMemoCollection>",
    "",
  ].join("\n");
}

// --- 3. Binary SM18/SM20 Collection Package Export --------------------------

function numberToReal48Hex(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return "000000000000";
  }
  const neg = value < 0;
  const abs = Math.abs(value);
  const expUnbiased = Math.floor(Math.log2(abs));
  const exponent = clamp(expUnbiased + REAL48_BIAS, 1, 255);
  const scaled = abs / Math.pow(2, exponent - REAL48_BIAS) - 1.0;
  const mant = Math.max(0, Math.min(REAL48_MANTISSA_SCALE - 1, Math.round(scaled * REAL48_MANTISSA_SCALE)));
  const low32 = mant % 0x100000000;
  const top7 = Math.floor(mant / 0x100000000) & 0x7f;

  const bytes = new Uint8Array(6);
  bytes[0] = exponent;
  bytes[1] = low32 & 0xff;
  bytes[2] = (low32 >>> 8) & 0xff;
  bytes[3] = (low32 >>> 16) & 0xff;
  bytes[4] = (low32 >>> 24) & 0xff;
  bytes[5] = top7 | (neg ? 0x80 : 0);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function epochMsToDelphiDate(ms: number): number {
  return (ms - DELPHI_EPOCH_MS) / MS_PER_DAY;
}

/**
 * Encodes `registry/concept.dat` (`0x41` = 65-byte fixed records per `0x00def250`).
 */
export function encodeConceptDat(
  concepts: readonly ConceptGroup[],
  smIdByElementId: ReadonlyMap<string, number>,
): Uint8Array {
  const out = new Uint8Array(concepts.length * 65);
  const view = new DataView(out.buffer);
  for (let i = 0; i < concepts.length; i += 1) {
    const c = concepts[i]!;
    const base = i * 65;
    const rootSmId = (c.rootElementId ? smIdByElementId.get(c.rootElementId) : undefined) ?? 1;
    view.setUint32(base + 0x00, rootSmId, true); // concept_element
    view.setUint32(base + 0x04, rootSmId, true); // root_element
    view.setUint32(base + 0x08, rootSmId, true); // hook_element
    view.setUint32(base + 0x20, i + 1, true); // registry_member (1-based)
    view.setFloat64(base + 0x29, clampPriority(c.defaultPriority ?? 33), true); // priority float64 at +0x29
  }
  return out;
}

function encodeSimpleTextRegistry(strings: readonly string[]): {
  mem: Uint8Array;
  ptr: Uint8Array;
  rtx: Uint8Array;
} {
  const encoder = new TextEncoder();
  const encodedChunks: Uint8Array[] = [];
  const positions: number[] = [];
  const lengths: number[] = [];
  let rtxOffset = 1; // 1-based rtx position

  for (let i = 0; i < strings.length; i += 1) {
    const bodyBytes = encoder.encode(strings[i]!);
    // SuperMemo .rtx span = text bytes + 6-byte trailer (\0 + uint32LE member_number + uint8 active=1)
    const span = new Uint8Array(bodyBytes.byteLength + 6);
    span.set(bodyBytes, 0);
    const sView = new DataView(span.buffer);
    span[bodyBytes.byteLength] = 0;
    sView.setUint32(bodyBytes.byteLength + 1, i + 1, true);
    span[bodyBytes.byteLength + 5] = 1;

    positions.push(rtxOffset);
    lengths.push(span.byteLength);
    encodedChunks.push(span);
    rtxOffset += span.byteLength;
  }

  const rtx = new Uint8Array(rtxOffset - 1);
  let cursor = 0;
  for (const chunk of encodedChunks) {
    rtx.set(chunk, cursor);
    cursor += chunk.byteLength;
  }

  // registry/*.ptr: 4-byte uint32LE member_number; registry/*.mem: 30-byte records
  const ptr = new Uint8Array(strings.length * 4);
  const ptrView = new DataView(ptr.buffer);
  const mem = new Uint8Array(strings.length * 30);
  const memView = new DataView(mem.buffer);

  for (let i = 0; i < strings.length; i += 1) {
    ptrView.setUint32(i * 4, i + 1, true);
    const base = i * 30;
    memView.setUint32(base + 0x00, 1, true); // use_count
    memView.setUint32(base + 0x0a, positions[i]!, true); // 1-based rtx position
    memView.setUint32(base + 0x0e, lengths[i]!, true); // span length incl. 6-byte trailer
  }

  return { mem, ptr, rtx };
}

export function exportSm20BinaryPackage(input: {
  elements: Iterable<IrElement>;
  concepts?: readonly ConceptGroup[];
  matrix?: Sm20Matrix;
  nowMs?: number;
}): Map<string, Uint8Array> {
  const nowMs = input.nowMs ?? Date.now();
  const active = Array.from(input.elements);
  const smIdByElementId = new Map<string, number>();
  active.forEach((el, idx) => smIdByElementId.set(el.id, idx + 1));

  const concepts = input.concepts ?? [];
  const conceptMemberById = new Map<string, number>();
  concepts.forEach((c, idx) => conceptMemberById.set(c.id, idx + 1));

  const textMembers: string[] = [];
  const elementInfoRecords: ElementInfoRecord[] = [];
  const contentsRecords: ContentsRecord[] = [];

  for (let i = 0; i < active.length; i += 1) {
    const el = active[i]!;
    const bodyWithRef = el.reference
      ? `${el.text.trim()}\n\n${formatSuperMemoReferenceFooter(el.reference)}`
      : el.text.trim();
    textMembers.push(bodyWithRef || `Element ${i + 1}`);
    const textMemberNo = textMembers.length;

    const parentSmId = el.parentId ? (smIdByElementId.get(el.parentId) ?? 0) : 0;
    const isItem = el.type === "item";
    const status = el.dismissed ? 2 : 1;
    const ivl = clamp(
      Math.round(isItem ? (el.card?.scheduledDays ?? 1) : (el.schedule?.interval ?? 1)),
      0,
      0xffff,
    );
    const reps = clamp(Math.round(isItem ? (el.card?.reps ?? 0) : 1), 0, 0xffff);
    const lapses = clamp(Math.round(isItem ? (el.card?.lapses ?? 0) : 0), 0, 0xffff);
    const lastMs = isItem ? (el.card?.lastReview ?? nowMs) : nowMs;
    const aFactor = isItem ? 1.5 : (el.schedule?.aFactor ?? 2.0);
    const d01 = isItem ? storedDifficultyTo01(el.card?.difficulty) : 0.3;
    const conceptMember = el.conceptId ? (conceptMemberById.get(el.conceptId) ?? 0) : 0;

    elementInfoRecords.push({
      element_type: isItem ? 1 : 0,
      element_status: status,
      text_registry_member: textMemberNo,
      compon_offset: -1,
      compon_body_length: 0,
      repetition_count: reps,
      lapse_count: lapses,
      interval_days: ivl,
      last_repetition_day: 1,
      last_repetition_date: epochMsToDelphiDate(lastMs),
      a_factor: { hex: numberToReal48Hex(aFactor) },
      u_factor: { hex: numberToReal48Hex(1.5) },
      last_repetition_row: 0,
      reference_registry_member: 0,
      forgetting_index: 10,
      total_postpone_count: 0,
      recent_postpone_count: 0,
      comment_registry_member: 0,
      template_registry_member: 0,
      concept_group_member: conceptMember,
      concept_definition_member: 0,
      reserved: 0,
      extraction_date: epochMsToDelphiDate(el.created || nowMs),
      legacy: 0,
      source_article: !isItem && parentSmId > 0 ? parentSmId : 0,
      difficulty: { hex: numberToReal48Hex(d01) },
      ordinal: { hex: numberToReal48Hex(i + 1) },
      first_grade: 4,
      legacy_element_number: i + 1,
      first_repetition_day: 1,
    });

    contentsRecords.push({
      unknown_0x00: 0,
      unknown_0x01: parentSmId,
      unknown_0x05: 0,
      unknown_0x09: 0,
      unknown_0x0d: 0,
      unknown_0x11: 0,
      unknown_0x15: 0,
      unknown_0x19: 0,
      unknown_0x1d: 0,
      unknown_0x21: 0,
    });
  }

  const prioritySorted = active
    .map((el, idx) => ({ smId: idx + 1, prio: el.priority }))
    .sort((a, b) => a.prio - b.prio || a.smId - b.smId);

  const emptyHeader = new Uint8Array(0);
  const files = new Map<string, Uint8Array>();
  files.set("info/ElementInfo.dat", writeElementInfo(emptyHeader, elementInfoRecords));
  files.set("info/contents.dat", writeContents(emptyHeader, contentsRecords));
  files.set(
    "info/priority.sub",
    writeSub(
      emptyHeader,
      prioritySorted.map((p) => ({ element_id: p.smId })),
    ),
  );

  const textRegFiles = encodeSimpleTextRegistry(textMembers);
  files.set("registry/text.mem", textRegFiles.mem);
  files.set("registry/text.ptr", textRegFiles.ptr);
  files.set("registry/text.rtx", textRegFiles.rtx);

  if (concepts.length > 0) {
    const conceptNames = concepts.map((c) => c.name);
    const conceptRegFiles = encodeSimpleTextRegistry(conceptNames);
    files.set("registry/concept.mem", conceptRegFiles.mem);
    files.set("registry/concept.ptr", conceptRegFiles.ptr);
    files.set("registry/concept.rtx", conceptRegFiles.rtx);
    files.set("registry/concept.dat", encodeConceptDat(concepts, smIdByElementId));
  }

  const alg17 = encodeSm20Alg17DatFiles(input.matrix ?? createEmptySm20Matrix());
  files.set("alg17/StabilityIncrease.dat", alg17.sinc);
  files.set("alg17/StabilityIncreaseCases.dat", alg17.sincCases);
  files.set("alg17/Recall.dat", alg17.recall);
  files.set("alg17/RecallCases.dat", alg17.recallCases);
  files.set("alg17/FirstInterval.dat", alg17.firstInterval);
  files.set("alg17/ForgettingCurve.dat", alg17.forgettingCurve);
  files.set("alg17/Retrievability.dat", alg17.retrievability);
  files.set("alg17/DifficultyDistribution.dat", alg17.difficultyDistribution);

  return files;
}

export interface SuperMemoExchangePreview {
  format: "empty" | "sm-xml" | "qa-txt";
  totalCount: number;
  topicCount: number;
  extractCount: number;
  itemCount: number;
  conceptNames: string[];
  samples: string[];
}

export function isSuperMemoXmlText(rawText: string): boolean {
  const trimmed = rawText.trim();
  return (
    trimmed.startsWith("<?xml") ||
    trimmed.includes("<SuperMemoCollection") ||
    trimmed.includes("<SuperMemoElement>")
  );
}

/**
 * Non-destructive preview of SuperMemo XML or Q&A text for the inline
 * Import/Export drawer — reports format, per-type counts, detected concepts,
 * and up to 5 clean preview labels before anything touches the vault/ledger.
 */
export function previewSuperMemoExchangeInput(
  rawText: string,
  defaultPriority = 33,
): SuperMemoExchangePreview {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return {
      format: "empty",
      totalCount: 0,
      topicCount: 0,
      extractCount: 0,
      itemCount: 0,
      conceptNames: [],
      samples: [],
    };
  }

  const dummyDevice = "dev_preview0000" as DeviceId;
  const isXml = isSuperMemoXmlText(trimmed);
  const parsed = isXml
    ? parseSuperMemoXmlCollection(trimmed, 0, dummyDevice)
    : { ...parseSuperMemoQaText(trimmed, 0, dummyDevice, defaultPriority), concepts: [] };

  let topicCount = 0;
  let extractCount = 0;
  let itemCount = 0;
  const samples: string[] = [];

  for (const el of parsed.elements) {
    if (el.type === "topic") topicCount += 1;
    else if (el.type === "extract") extractCount += 1;
    else itemCount += 1;

    if (samples.length < 5) {
      const firstLine = (el.text ?? "")
        .replace(/\{\{c\d+(?:::|:=)([\s\S]*?)\}\}/g, (_m, inner: string) => inner.split("::")[0] ?? "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);
      if (firstLine) {
        samples.push(firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine);
      }
    }
  }

  return {
    format: isXml ? "sm-xml" : "qa-txt",
    totalCount: parsed.elements.length,
    topicCount,
    extractCount,
    itemCount,
    conceptNames: parsed.concepts.map((c) => c.name),
    samples,
  };
}
