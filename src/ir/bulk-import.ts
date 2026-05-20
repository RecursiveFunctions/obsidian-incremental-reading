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
    let bodyLines: string[] = [];
    let foundTitleLine = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!foundTitleLine) {
        if (trimmedLine !== "") {
          foundTitleLine = true;
          continue; // Skip the title line
        }
      } else {
        // After title line, skip blank lines until we find non-blank content
        if (trimmedLine === "") {
          continue;
        }
        bodyLines.push(line);
      }
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
function createFrontmatter(defaultPriority: number, now: number): Record<string, unknown> {
  return {
    "ir-type": "topic",
    "ir-priority": defaultPriority,
    "ir-due": now
  };
}

/**
 * Main function to plan bulk import from text input.
 * 
 * This is a pure function that transforms input text into a structured plan
 * following all the specified rules. It never throws and handles all edge cases.
 */
export function planBulkImport(input: BulkImportInput): BulkImportPlan {
  const { text, defaultPriority, now, titleHint } = input;

  // Resolve and sanitize title
  const resolvedTitle = resolveTitle(text, titleHint);
  const title = sanitizeTitle(resolvedTitle);

  // Extract body based on title resolution
  const body = extractBody(text, titleHint);

  // Create frontmatter
  const frontmatter = createFrontmatter(defaultPriority, now);

  return {
    title,
    body,
    frontmatter
  };
}
