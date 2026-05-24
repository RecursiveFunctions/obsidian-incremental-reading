/**
 * A tiny in-memory stand-in for the slice of the Obsidian API that
 * `src/ir-note.ts` touches: an App with `vault`, `metadataCache`, and
 * `fileManager.processFrontMatter`, plus an Editor with a fixed selection.
 *
 * It is deliberately not faithful to all of Obsidian. It models exactly the
 * behaviors the code under test depends on: files/folders exist or do not,
 * frontmatter is a mutable object the metadata cache reflects, and
 * `processFrontMatter` mutates that object in place.
 */

import type { App, Editor, TFile } from "obsidian";

export interface FakeFile {
  path: string;
  basename: string;
  extension: string;
  parent: { path: string } | null;
}

function makeFile(path: string): FakeFile {
  const slash = path.lastIndexOf("/");
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  return {
    path,
    basename: dot >= 0 ? name.slice(0, dot) : name,
    extension: dot >= 0 ? name.slice(dot + 1) : "",
    parent: { path: slash >= 0 ? path.slice(0, slash) : "" },
  };
}

interface Stored {
  file: FakeFile;
  body: string;
  frontmatter: Record<string, unknown>;
}

export class FakeApp {
  private files = new Map<string, Stored>();
  private folders = new Set<string>();

  /** Seed a pre-existing note with frontmatter (e.g. an IR topic source). */
  seed(
    path: string,
    frontmatter: Record<string, unknown> = {},
    body = "",
  ): FakeFile {
    const file = makeFile(path);
    this.files.set(path, { file, body, frontmatter: { ...frontmatter } });
    return file;
  }

  /** Frontmatter as the metadata cache would report it after writes. */
  frontmatterOf(path: string): Record<string, unknown> | undefined {
    return this.files.get(path)?.frontmatter;
  }

  bodyOf(path: string): string | undefined {
    return this.files.get(path)?.body;
  }

  has(path: string): boolean {
    return this.files.has(path);
  }

  vault = {
    getMarkdownFiles: (): FakeFile[] =>
      [...this.files.values()].map((s) => s.file),
    getAbstractFileByPath: (p: string): unknown =>
      this.files.get(p)?.file ?? (this.folders.has(p) ? { path: p } : null),
    createFolder: async (p: string): Promise<void> => {
      this.folders.add(p);
    },
    create: async (p: string, content: string): Promise<FakeFile> => {
      if (this.files.has(p)) throw new Error(`exists: ${p}`);
      const file = makeFile(p);
      this.files.set(p, { file, body: content, frontmatter: {} });
      return file;
    },
    cachedRead: async (file: FakeFile): Promise<string> =>
      this.files.get(file.path)?.body ?? "",
    // `saveBody` calls `read` to recover the frontmatter prefix before
    // writing the new body, so the fake must return the body untouched
    // here too — there is no separate frontmatter prefix in the fake's
    // body buffer (frontmatter is stored as a parsed object instead).
    read: async (file: FakeFile): Promise<string> =>
      this.files.get(file.path)?.body ?? "",
    // `saveBody` ends with `modify(file, prefix + body + "\n")`; since the
    // fake's `read` returns body-only, `prefix` is empty and `content` is
    // just the new body. Persist it verbatim.
    modify: async (file: FakeFile, content: string): Promise<void> => {
      const s = this.files.get(file.path);
      if (!s) throw new Error(`no file: ${file.path}`);
      s.body = content;
    },
  };

  metadataCache = {
    getFileCache: (
      file: FakeFile,
    ): { frontmatter: Record<string, unknown> } | null => {
      const s = this.files.get(file.path);
      return s ? { frontmatter: s.frontmatter } : null;
    },
  };

  fileManager = {
    processFrontMatter: async (
      file: FakeFile,
      fn: (fm: Record<string, unknown>) => void,
    ): Promise<void> => {
      const s = this.files.get(file.path);
      if (!s) throw new Error(`no file: ${file.path}`);
      fn(s.frontmatter);
    },
  };

  /** The code under test is typed against Obsidian's `App`. */
  asApp(): App {
    return this as unknown as App;
  }
}

function lineOffset(lines: string[], pos: { line: number; ch: number }): number {
  let off = 0;
  for (let i = 0; i < pos.line; i += 1) off += lines[i]!.length + 1;
  return off + pos.ch;
}

function offsetToLine(
  lines: string[],
  offset: number,
): { line: number; ch: number } {
  let acc = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const lineEnd = acc + lines[i]!.length;
    if (offset <= lineEnd) return { line: i, ch: offset - acc };
    acc = lineEnd + 1;
  }
  const last = lines.length - 1;
  return { line: last, ch: lines[last]?.length ?? 0 };
}

/** A fixed-selection Editor over `lines`, selecting [from .. to]. */
export function fakeEditor(
  lines: string[],
  from: { line: number; ch: number },
  to: { line: number; ch: number },
): Editor {
  const selection =
    from.line === to.line
      ? lines[from.line].slice(from.ch, to.ch)
      : [
          lines[from.line].slice(from.ch),
          ...lines.slice(from.line + 1, to.line),
          lines[to.line].slice(0, to.ch),
        ].join("\n");

  return {
    getSelection: () => selection,
    getCursor: (which: "from" | "to") => (which === "from" ? from : to),
    getLine: (n: number) => lines[n],
    posToOffset: (pos: { line: number; ch: number }) => lineOffset(lines, pos),
    offsetToPos: (offset: number) => offsetToLine(lines, offset),
  } as unknown as Editor;
}

export type { TFile };
