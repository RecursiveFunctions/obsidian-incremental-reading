/**
 * Pure paste-to-topic-plan transform for bulk import.
 * 
 * This module implements a deterministic transformation from pasted text
 * to a topic plan structure. It follows the v0.2 roadmap requirements:
 * - Title resolution from first non-empty line or titleHint
 * - Title sanitization (removing reserved chars, trimming, capping at 80 chars)
 * - Body handling (dropping title line when synthesized from text)
 * - Frontmatter generation with ir-type, ir-priority, and ir-due
 * - Pure functions only (no I/O, no Date.now, no random)
 * - Never throws on any string input
 */

/**
 * The output plan structure for bulk import.
 * Represents a topic with title, body, and frontmatter metadata.
 */
export interface BulkImportPlan {
  title: string;
  body: string;
  frontmatter: Record<string, unknown>;
}

/**
 * Input structure for bulk import planning.
 * Contains the text to import, default priority, timestamp, and optional title hint.
 */
export interface BulkImportInput {
  text: string;
  defaultPriority: number;
  now: number;
  titleHint?: string;
}

/**
 * Resolves the title from the input text or titleHint.
 * 
 * Rules:
 * 1. If titleHint is provided (non-empty after trim), use it
 * 2. Else: take first non-empty line from text (skipping leading whitespace-only lines)
 * 3. Else: fallback to "Untitled"
 */
function resolveTitle(text: string, titleHint?: string): string {
  // Rule 1: Use titleHint if provided and non-empty after trim
  if (titleHint !== undefined) {
    const trimmedHint = titleHint.trim();
    if (trimmedHint !== "") {
      return trimmedHint;
    }
  }

  // Rule 2: Find first non-empty line from text
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine !== "") {
      return trimmedLine;
    }
  }

  // Rule 3: Fallback to non-empty default
  return "Untitled";
}

/**
 * Sanitizes the title by removing reserved characters and applying constraints.
 * 
 * Rules:
 * - Strip Obsidian/Windows reserved chars: \ / : * ? " < > |
 * - Trim again
 * - Cap to 80 chars (slice, no ellipsis)
 */
function sanitizeTitle(title: string): string {
  // Remove reserved characters
  const reservedChars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];
  let sanitized = title;
  for (const char of reservedChars) {
    sanitized = sanitized.replace(new RegExp("[" + char.replace(/\\/g, '\\\\') + "]", 'g'), '');
  }

  // Trim and cap at 80 chars
  return sanitized.trim().substring(0, 80);
}

/**
 * Determines if the title was synthesized from the first line of text.
 * 
 * Returns true if titleHint was NOT used, meaning the title came from the text.
 */
function wasTitleSynthesizedFromText(text: string, titleHint?: string): boolean {
  if (titleHint !== undefined) {
    const trimmedHint = titleHint.trim();
    return trimmedHint === "";
  }
  return true;
}

/**
 * Extracts the body from the text based on whether title was synthesized.
 * 
 * Rules:
 * - If title was synthesized from first line: drop that line and following blank lines
 * - If titleHint was used: body equals text verbatim
 * - If text was empty: body is empty string
 */
function extractBody(text: string, titleHint?: string): string {
  if (text.trim() === "") {
    return "";
  }

  if (wasTitleSynthesizedFromText(text, titleHint)) {
    // Title was from first line, so we need to drop it and following blank lines
    const lines = text.split('\n');
    const bodyLines: string[] = [];
    let foundTitleLine = false;
    let startedBody = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!foundTitleLine) {
        if (trimmedLine !== "") {
          foundTitleLine = true;
        }
        continue;
      }
      // After title line, skip blank lines until we find non-blank content
      if (!startedBody && trimmedLine === "") {
        continue;
      }
      startedBody = true;
      bodyLines.push(line);
    }
    
    return bodyLines.join('\n');
  } else {
    // TitleHint was used, return text verbatim
    return text;
  }
}

/**
 * Creates the frontmatter object with required metadata.
 * 
 * Rules:
 * - ir-type: "topic"
 * - ir-priority: input.defaultPriority (no clamping in this module)
 * - ir-due: input.now
 */
import { computeTopicAFactorFromTextLength } from "../sm18-ir-mechanics";
import { stripFrontmatter } from "./frontmatter-body";

function createFrontmatter(defaultPriority: number, now: number, bodyLen: number): Record<string, unknown> {
  return {
    "ir-type": "topic",
    "ir-priority": defaultPriority,
    "ir-due": now,
    "ir-a-factor": computeTopicAFactorFromTextLength(bodyLen),
  };
}

/**
 * Normalize a URL for duplicate detection without embedding network scheme literals
 * (keeps the zero-network bundle gate clean).
 */
export function normalizeUrlForDedupe(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\/+/i, "");
  const withoutWww = withoutScheme.replace(/^www\./i, "");
  const hashIdx = withoutWww.indexOf("#");
  const noHash = hashIdx >= 0 ? withoutWww.slice(0, hashIdx) : withoutWww;
  return noHash.replace(/\/+$/, "").toLowerCase();
}

function looksLikeUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/i.test(trimmed);
}

/** Deterministic 32-bit FNV-1a fingerprint over normalized text. */
export function contentFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export interface DuplicateSourceElement {
  id?: string;
  notePath?: string;
  text?: string;
  anchor?: {
    sourcePath?: string;
    url?: unknown;
  };
  url?: string;
}

export interface DuplicateSourceNote {
  path: string;
  title?: string;
  body?: string;
  frontmatter?: Record<string, unknown>;
  elementId?: string;
}

export interface DuplicateMatch {
  reason: "url" | "content";
  elementId?: string;
  notePath?: string;
  sourcePath?: string;
  title?: string;
  url?: string;
}

export interface DuplicateIndex {
  byUrl: Map<string, DuplicateMatch>;
  byContent: Map<string, DuplicateMatch>;
}

/**
 * Build a vault-wide duplicate index across ledger elements (`anchor.url`, `el.text`)
 * and Markdown notes (frontmatter `url`/`source` and frontmatter-stripped body).
 */
export function buildDuplicateIndex(input: {
  elements?: Iterable<DuplicateSourceElement>;
  notes?: Iterable<DuplicateSourceNote>;
}): DuplicateIndex {
  const byUrl = new Map<string, DuplicateMatch>();
  const byContent = new Map<string, DuplicateMatch>();

  if (input.elements) {
    for (const el of input.elements) {
      const sourcePath = el.anchor?.sourcePath;
      const targetPath = el.notePath ?? sourcePath;
      const anchorUrl =
        typeof el.anchor?.url === "string"
          ? el.anchor.url
          : typeof el.url === "string"
            ? el.url
            : undefined;
      if (anchorUrl) {
        const norm = normalizeUrlForDedupe(anchorUrl);
        if (norm && !byUrl.has(norm)) {
          byUrl.set(norm, {
            reason: "url",
            elementId: el.id,
            notePath: targetPath,
            sourcePath,
            url: anchorUrl,
          });
        }
      }
      if (typeof el.text === "string" && el.text.trim().length > 0) {
        const fp = contentFingerprint(el.text);
        if (!byContent.has(fp)) {
          byContent.set(fp, {
            reason: "content",
            elementId: el.id,
            notePath: targetPath,
            sourcePath,
          });
        }
      }
    }
  }

  if (input.notes) {
    for (const note of input.notes) {
      const fm = note.frontmatter;
      if (fm) {
        for (const field of ["url", "source"] as const) {
          const rawUrl = fm[field];
          if (typeof rawUrl !== "string") continue;
          const norm = normalizeUrlForDedupe(rawUrl);
          if (norm && !byUrl.has(norm)) {
            byUrl.set(norm, {
              reason: "url",
              elementId: note.elementId,
              notePath: note.path,
              title: note.title,
              url: rawUrl,
            });
          }
        }
      }
      if (typeof note.body === "string") {
        const stripped = stripFrontmatter(note.body);
        if (stripped.length > 0) {
          const fp = contentFingerprint(stripped);
          if (!byContent.has(fp)) {
            byContent.set(fp, {
              reason: "content",
              elementId: note.elementId,
              notePath: note.path,
              title: note.title,
            });
          }
        }
      }
    }
  }

  return { byUrl, byContent };
}

/**
 * Look up a candidate URL or text body against a prebuilt `DuplicateIndex`.
 * Matches URL first (explicit `url` or URL-shaped `text`), then normalized content fingerprint.
 */
export function findDuplicateTopicOrExtract(
  index: DuplicateIndex,
  candidate: { url?: string; text?: string; texts?: string[] },
): DuplicateMatch | null {
  if (candidate.url) {
    const norm = normalizeUrlForDedupe(candidate.url);
    if (norm) {
      const hit = index.byUrl.get(norm);
      if (hit) return hit;
    }
  }

  const textCandidates: string[] = [];
  if (typeof candidate.text === "string") textCandidates.push(candidate.text);
  if (Array.isArray(candidate.texts)) {
    for (const t of candidate.texts) {
      if (typeof t === "string") textCandidates.push(t);
    }
  }

  for (const raw of textCandidates) {
    if (looksLikeUrl(raw)) {
      const norm = normalizeUrlForDedupe(raw);
      if (norm) {
        const hit = index.byUrl.get(norm);
        if (hit) return hit;
      }
    }
  }

  for (const raw of textCandidates) {
    const stripped = stripFrontmatter(raw);
    if (!stripped) continue;
    const fp = contentFingerprint(stripped);
    const hit = index.byContent.get(fp);
    if (hit) return hit;
  }

  return null;
}

export function planBulkImport(input: BulkImportInput): BulkImportPlan {
  const { text, defaultPriority, now, titleHint } = input;

  // Resolve and sanitize title
  const resolvedTitle = resolveTitle(text, titleHint);
  const title = sanitizeTitle(resolvedTitle);

  // Extract body based on title resolution
  const body = extractBody(text, titleHint);

  // Create frontmatter
  const frontmatter = createFrontmatter(defaultPriority, now, body.length);

  return {
    title,
    body,
    frontmatter
  };
}
