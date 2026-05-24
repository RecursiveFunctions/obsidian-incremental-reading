/**
 * Operations on a note as an IR element.
 *
 * Every frontmatter mutation goes through Obsidian's
 * `fileManager.processFrontMatter`, which is atomic, preserves unrelated keys,
 * and round-trips YAML formatting correctly. Never hand-edit the file text.
 *
 * The Obsidian imports here are type-only so this module carries no runtime
 * dependency on the Obsidian API and can be exercised by an in-memory fake.
 */

import type { App, Editor, TFile } from "obsidian";
import { IR_KEYS } from "./types";
import { clampPriority, type IrType, PRIORITY_MAX, PRIORITY_MIN } from "./ir/model";
import { newCard, writeCardToFrontmatter } from "./fsrs";
import {
  TopicScheduleSettings,
  newTopicState,
  writeTopicToFrontmatter,
} from "./topic";
import {
  buildClozeBody,
  buildClozeFromText,
  nextClozeNumber,
  spliceClozeIntoText,
} from "./cloze";
import {
  sanitizeExtractSelection,
  saveBody,
  stripFrontmatter,
  wrapExtractHighlight,
} from "./ir/frontmatter-body";
import { locateTextInBody } from "./ir/selection-map";

/**
 * Slash-only stand-in for Obsidian's `normalizePath`: collapse repeats,
 * strip leading/trailing separators, trim. Enough for the folder and file
 * paths this module builds.
 */
export function normalizePath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

/** First unused `<folder>/<stem>.md` path, appending " 2", " 3", ... if taken. */
export function uniqueMarkdownNotePath(app: App, folder: string, stem: string): string {
  const dir = folder ? `${folder}/` : "";
  let candidate = normalizePath(`${dir}${stem}.md`);
  let n = 2;
  while (app.vault.getAbstractFileByPath(candidate)) {
    candidate = normalizePath(`${dir}${stem} ${n}.md`);
    n += 1;
  }
  return candidate;
}

/**
 * Settings the topic-mark and child-note creators need: priority + folder,
 * plus the topic schedule tunables so reading elements seed correctly.
 */
export interface IrNoteSettings extends TopicScheduleSettings {
  defaultPriority: number;
  extractFolder: string;
}

/** The current IR type of a file, or null if it isn't an IR element yet. */
export function getIrType(app: App, file: TFile): IrType | null {
  const t = app.metadataCache.getFileCache(file)?.frontmatter?.[IR_KEYS.type];
  return t === "topic" || t === "extract" || t === "item" ? t : null;
}

/**
 * Mark a note as an IR *topic* (a reading source): set `ir-type`/`ir-priority`
 * and seed a fresh topic schedule (SuperMemo reading model, not FSRS - topics
 * are never graded). Idempotent on identity: if the note is already a topic
 * this is a no-op and returns false so the caller can inform the user.
 */
export async function markAsTopic(
  app: App,
  file: TFile,
  settings: IrNoteSettings,
): Promise<boolean> {
  if (getIrType(app, file) === "topic") return false;

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[IR_KEYS.type] = "topic" satisfies IrType;
    if (typeof fm[IR_KEYS.priority] !== "number") {
      fm[IR_KEYS.priority] = clampPriority(settings.defaultPriority);
    }
    writeTopicToFrontmatter(fm, newTopicState(settings));
  });

  return true;
}

/** Read a note's IR priority, falling back to `defaultPriority` if unset. */
export function getPriority(
  app: App,
  file: TFile,
  defaultPriority: number,
): number {
  const v = app.metadataCache.getFileCache(file)?.frontmatter?.[
    IR_KEYS.priority
  ];
  return clampPriority(typeof v === "number" ? v : defaultPriority);
}

/**
 * Set an IR element's priority (0-100 SuperMemo percentile, lower = more
 * important), clamping into range. Returns false if the file is not an IR
 * element. Touches only `ir-priority`, so it never disturbs the schedule.
 */
export async function setPriority(
  app: App,
  file: TFile,
  priority: number,
): Promise<boolean> {
  if (!getIrType(app, file)) return false;
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[IR_KEYS.priority] = clampPriority(priority);
  });
  return true;
}

/** True if the file is currently dismissed (held out of the queue). */
export function isDismissed(app: App, file: TFile): boolean {
  return (
    app.metadataCache.getFileCache(file)?.frontmatter?.[
      IR_KEYS.dismissed
    ] === true
  );
}

/**
 * Dismiss or restore an IR element. Dismissing keeps the note and all its
 * FSRS state untouched; it only sets a flag the queue honors, so it is fully
 * reversible. Returns false if the file is not an IR element.
 */
export async function setDismissed(
  app: App,
  file: TFile,
  dismissed: boolean,
): Promise<boolean> {
  if (!getIrType(app, file)) return false;
  await app.fileManager.processFrontMatter(file, (fm) => {
    if (dismissed) fm[IR_KEYS.dismissed] = true;
    else delete fm[IR_KEYS.dismissed];
  });
  return true;
}

/**
 * Turn a chunk of text into a stem for a generated note's filename:
 * first words only, no Markdown noise, no characters illegal in a vault path.
 */
function fileStem(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/[#*_`>\[\]()~]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
  const stem = cleaned.split(" ").slice(0, 8).join(" ").slice(0, 60).trim();
  return stem.replace(/^\.+|\.+$/g, "") || "IR note";
}

/**
 * The result of a child-note creation. `file` is the created note;
 * `error` explains a refusal so the caller can surface a precise Notice.
 */
export type IrNoteResult =
  | { file: TFile; error?: undefined }
  | { file?: undefined; error: string };

/**
 * Shared core for extract/cloze: validate the source is a readable IR
 * element, place the new note (extract folder or beside the source), seed
 * its frontmatter (type, parent, inherited priority, fresh FSRS card).
 */
async function createChildNote(
  app: App,
  source: TFile,
  type: Extract<IrType, "extract" | "item">,
  body: string,
  nameFrom: string,
  settings: IrNoteSettings,
): Promise<IrNoteResult> {
  const sourceType = getIrType(app, source);
  if (sourceType !== "topic" && sourceType !== "extract") {
    return {
      error: `"${source.basename}" is not an IR topic. Mark it as a topic first.`,
    };
  }

  const configured = settings.extractFolder.trim();
  const folder = configured
    ? normalizePath(configured)
    : (source.parent?.path ?? "");
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }

  const path = uniqueMarkdownNotePath(app, folder, fileStem(nameFrom));
  const file = await app.vault.create(path, body.trim() + "\n");

  const inherited = getPriority(app, source, settings.defaultPriority);
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[IR_KEYS.type] = type satisfies IrType;
    fm[IR_KEYS.parent] = source.path;
    fm[IR_KEYS.priority] = inherited;
    // An extract is itself a reading element (a sub-topic), so it uses the
    // topic schedule. Only a cloze item is graded, so only it gets an FSRS
    // card.
    if (type === "item") writeCardToFrontmatter(fm, newCard());
    else writeTopicToFrontmatter(fm, newTopicState(settings));
  });

  return { file };
}

/**
 * Create a child *extract* note from text selected inside an IR topic or
 * extract. The new note holds only the selected text and enters the queue
 * as a sub-topic.
 */
/**
 * Mark the extracted span in the source note and every ancestor topic/extract
 * (via `ir-parent`), so the original passage stays visible when you open the
 * parent topic. Body offsets match review-mode selection math.
 */
export async function markExtractedSpan(
  app: App,
  source: TFile,
  start: number,
  end: number,
  selectedText: string,
): Promise<void> {
  const body = stripFrontmatter(await app.vault.cachedRead(source));
  const updated = wrapExtractHighlight(body, start, end);
  if (updated !== body) await saveBody(app, source, updated);

  let parentPath = app.metadataCache.getFileCache(source)?.frontmatter?.[
    IR_KEYS.parent
  ];
  while (typeof parentPath === "string" && parentPath.length > 0) {
    const parent = app.vault.getAbstractFileByPath(parentPath);
    if (!parent || !("extension" in parent) || parent.extension !== "md") break;
    const parentFile = parent as TFile;
    const parentBody = stripFrontmatter(
      await app.vault.cachedRead(parentFile),
    );
    const located = locateTextInBody(parentBody, selectedText);
    if (located) {
      const parentUpdated = wrapExtractHighlight(
        parentBody,
        located.start,
        located.end,
      );
      if (parentUpdated !== parentBody) {
        await saveBody(app, parentFile, parentUpdated);
      }
    }
    parentPath = app.metadataCache.getFileCache(parentFile)?.frontmatter?.[
      IR_KEYS.parent
    ];
  }
}

export async function createExtract(
  app: App,
  source: TFile,
  selection: string,
  settings: IrNoteSettings,
): Promise<IrNoteResult> {
  const text = sanitizeExtractSelection(selection);
  if (!text) return { error: "Nothing selected." };
  return createChildNote(app, source, "extract", text, text, settings);
}

/**
 * Create a child *item* note holding a cloze deletion. The selected span
 * becomes the hidden answer; the full lines it spans are kept as context so
 * the question still makes sense on its own during review.
 */
export async function createCloze(
  app: App,
  source: TFile,
  editor: Editor,
  settings: IrNoteSettings,
  hint?: string,
): Promise<IrNoteResult> {
  const anchor = editor.getCursor("from");
  const head = editor.getCursor("to");
  const selStart = editor.posToOffset(anchor);
  const selEnd = editor.posToOffset(head);
  if (selEnd <= selStart) return { error: "Nothing selected." };

  const fromPos = editor.offsetToPos(selStart);
  const toPos = editor.offsetToPos(selEnd);
  const spanned: string[] = [];
  for (let line = fromPos.line; line <= toPos.line; line += 1) {
    spanned.push(editor.getLine(line));
  }

  const { body, answer } = buildClozeBody(
    spanned,
    fromPos.ch,
    toPos.ch,
    hint,
  );
  const trimmed = answer.trim();
  if (!trimmed) return { error: "Nothing selected." };
  return createChildNote(app, source, "item", body, trimmed, settings);
}

/**
 * Editor-free variant of `createCloze`: same cloze child-note creation, but
 * driven by a raw text and absolute selection offsets. Used by the Review
 * modal, where there is no Obsidian `Editor` to read selection through.
 */
export async function createClozeFromText(
  app: App,
  source: TFile,
  raw: string,
  selStart: number,
  selEnd: number,
  settings: IrNoteSettings,
  hint?: string,
): Promise<IrNoteResult> {
  if (selEnd <= selStart) return { error: "Nothing selected." };
  const { body, answer } = buildClozeFromText(raw, selStart, selEnd, hint);
  const trimmed = answer.trim();
  if (!trimmed) return { error: "Nothing selected." };
  return createChildNote(app, source, "item", body, trimmed, settings);
}

/**
 * Splice a literal `{{cN::answer}}` cloze marker into a source note's body
 * (file-backed) so the user gets immediate visible feedback in the review
 * pane when clozing from a topic / extract. `N` is picked by
 * {@link nextClozeNumber} on the existing body, so subsequent clozes bump
 * to c2, c3, … instead of stacking duplicate c1 groups.
 *
 * Returns the updated body plus the group number written and the captured
 * answer text. If the selection is empty, no write happens and `answer` is
 * the empty string.
 */
export async function addClozeMarkerToSourceFile(
  app: App,
  file: TFile,
  selStart: number,
  selEnd: number,
  hint?: string,
): Promise<{ groupN: number; answer: string; newBody: string }> {
  const raw = stripFrontmatter(await app.vault.read(file));
  if (selEnd <= selStart) return { groupN: 1, answer: "", newBody: raw };
  const groupN = nextClozeNumber(raw);
  const { body, answer } = spliceClozeIntoText(
    raw,
    selStart,
    selEnd,
    hint,
    groupN,
  );
  if (!answer.trim()) return { groupN, answer: "", newBody: raw };
  await saveBody(app, file, body);
  return { groupN, answer, newBody: body };
}

/**
 * Create a new graded IR **item** note under `parent` (topic or extract file).
 * Used when the active editor belongs to a different file (e.g. an item) but
 * `ir-parent` should still point at the reading source.
 */
export async function createIrItemChildNote(
  app: App,
  parent: TFile,
  body: string,
  nameFrom: string,
  settings: IrNoteSettings,
): Promise<IrNoteResult> {
  return createChildNote(app, parent, "item", body, nameFrom, settings);
}
