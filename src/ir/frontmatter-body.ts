/** Frontmatter-aware body read/write helpers. Pure string logic, no Obsidian. */

import type { App, TFile } from "obsidian";

const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

/** Drop the YAML frontmatter block so only the note body is rendered. */
export function stripFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_RE, "").trim();
}

/**
 * Write a new body back to a note while preserving its existing frontmatter
 * block byte-for-byte. The Obsidian `processFrontMatter` API only lets us
 * mutate frontmatter, not body, so we splice via `vault.modify` instead.
 */
export async function saveBody(app: App, file: TFile, newBody: string): Promise<void> {
  const full = await app.vault.read(file);
  const fm = full.match(FRONTMATTER_RE);
  const prefix = fm ? fm[0] : "";
  await app.vault.modify(file, prefix + newBody.trimEnd() + "\n");
}
