/**
 * Pure capture logic for mobile text capture. No Obsidian imports so the
 * unit tests run under Node's test runner.
 */

export type CaptureMode = "extract" | "cloze" | "topic";

export interface CaptureInput {
  text: string;
  mode: CaptureMode;
  /** For cloze: the clozed body (text with {{cN::answer}}). */
  clozedBody?: string;
  /** For cloze: the hint. */
  hint?: string;
  /** For topic: the note title. */
  title?: string;
}

export interface CaptureResult {
  mode: CaptureMode;
  /** The text to store on the element. */
  text: string;
  /** For cloze: the full clozed body. */
  clozedBody?: string;
  /** For cloze: the hint. */
  hint?: string;
  /** For topic: the note title. */
  title?: string;
  /** Whether the input is valid for capture. */
  valid: boolean;
  /** Error message when invalid. */
  error?: string;
}

export function validateCapture(input: CaptureInput): CaptureResult {
  const trimmed = input.text.trim();
  if (!trimmed) {
    return { mode: input.mode, text: "", valid: false, error: "Nothing to capture." };
  }
  if (input.mode === "cloze") {
    if (!input.clozedBody || !input.clozedBody.trim()) {
      return { mode: input.mode, text: trimmed, valid: false, error: "Cloze body is empty." };
    }
  }
  if (input.mode === "topic") {
    if (!input.title || !input.title.trim()) {
      return { mode: input.mode, text: trimmed, valid: false, error: "Title is required." };
    }
  }
  return {
    mode: input.mode,
    text: trimmed,
    clozedBody: input.clozedBody,
    hint: input.hint,
    title: input.title,
    valid: true,
  };
}

/**
 * Build the clozed body from raw text and a cloze range.
 * Wraps the selected portion as {{c1::answer}} with optional hint.
 */
export function buildClozedBody(
  raw: string,
  selStart: number,
  selEnd: number,
  hint?: string,
): string {
  if (selEnd <= selStart) return raw;
  const before = raw.slice(0, selStart);
  const answer = raw.slice(selStart, selEnd);
  const after = raw.slice(selEnd);
  const h = hint?.trim();
  const cloze = h ? `{{c1::${answer}::${h}}}` : `{{c1::${answer}}}`;
  return `${before}${cloze}${after}`;
}

/**
 * Determine the default capture mode based on whether the text looks like
 * a single word/phrase (cloze) or a longer passage (extract).
 */
export function suggestCaptureMode(text: string): CaptureMode {
  const trimmed = text.trim();
  if (!trimmed) return "extract";
  const words = trimmed.split(/\s+/);
  if (words.length <= 3) return "cloze";
  return "extract";
}
