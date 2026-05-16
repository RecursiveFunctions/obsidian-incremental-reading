/**
 * Operations on a note as an IR element.
 *
 * Every frontmatter mutation goes through Obsidian's
 * `fileManager.processFrontMatter`, which is atomic, preserves unrelated keys,
 * and round-trips YAML formatting correctly — never hand-edit the file text.
 */

import { App, TFile, normalizePath } from "obsidian";
import { IR_KEYS, IrType, PRIORITY_MAX, PRIORITY_MIN } from "./types";
import { newCard, writeCardToFrontmatter } from "./fsrs";

/** Clamp an arbitrary number into the valid 0–100 priority range. */
export function clampPriority(value: number): number {
  if (!Number.isFinite(value)) return PRIORITY_MAX;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(value)));
}

/** The current IR type of a file, or null if it isn't an IR element yet. */
export function getIrType(app: App, file: TFile): IrType | null {
  const t = app.metadataCache.getFileCache(file)?.frontmatter?.[IR_KEYS.type];
  return t === "topic" || t === "extract" || t === "item" ? t : null;
}

/**
 * Mark a note as an IR *topic* (a reading source): set `ir-type`/`ir-priority`
 * and seed a fresh FSRS card. Idempotent on identity — if the note is already
 * a topic this is a no-op and returns false so the caller can inform the user.
 */
export async function markAsTopic(
  app: App,
  file: TFile,
  defaultPriority: number,
): Promise<boolean> {
  if (getIrType(app, file) === "topic") return false;

  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[IR_KEYS.type] = "topic" satisfies IrType;
    if (typeof fm[IR_KEYS.priority] !== "number") {
      fm[IR_KEYS.priority] = clampPriority(defaultPriority);
    }
    writeCardToFrontmatter(fm, newCard());
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
 * Turn a chunk of selected text into a stem for the extract's filename:
 * first words only, no Markdown noise, no characters illegal in a vault path.
 */
function fileStemFromSelection(selection: string): string {
  const cleaned = selection
    .replace(/\s+/g, " ")
    .replace(/[#*_`>\[\]()~]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
  const stem = cleaned.split(" ").slice(0, 8).join(" ").slice(0, 60).trim();
  return stem.replace(/^\.+|\.+$/g, "") || "Extract";
}

/** First unused `<folder>/<stem>.md` path, appending " 2", " 3", ... if taken. */
function uniqueNotePath(app: App, folder: string, stem: string): string {
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
 * The result of an extract attempt. `file` is the created child note;
 * `error` explains a refusal so the caller can surface a precise Notice.
 */
export type ExtractResult =
  | { file: TFile; error?: undefined }
  | { file?: undefined; error: string };

/**
 * Create a child *extract* note from text selected inside an IR topic or
 * extract. The new note holds only the selected text, points back at its
 * source via `ir-parent`, inherits the source's priority, and gets a fresh
 * FSRS card so it enters the queue as a sub-topic.
 */
export async function createExtract(
  app: App,
  source: TFile,
  selection: string,
  settings: { defaultPriority: number; extractFolder: string },
): Promise<ExtractResult> {
  const text = selection.trim();
  if (!text) return { error: "Nothing selected." };

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

  const path = uniqueNotePath(app, folder, fileStemFromSelection(text));
  const file = await app.vault.create(path, text + "\n");

  const inherited = getPriority(app, source, settings.defaultPriority);
  await app.fileManager.processFrontMatter(file, (fm) => {
    fm[IR_KEYS.type] = "extract" satisfies IrType;
    fm[IR_KEYS.parent] = source.path;
    fm[IR_KEYS.priority] = inherited;
    writeCardToFrontmatter(fm, newCard());
  });

  return { file };
}
