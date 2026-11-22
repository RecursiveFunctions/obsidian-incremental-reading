import type { VaultFs } from "./ledger";
import { isSafeVaultRelativePath } from "./source-paths";

export function assertIrInternalPath(p: string): string {
  if (p === ".ir" || (isSafeVaultRelativePath(p) && p.startsWith(".ir/"))) {
    return p;
  }
  throw new Error(`ObsidianVaultFs: path escapes .ir/ boundary: "${p}"`);
}

export interface ObsidianDataAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
}

function ancestorFolders(filePath: string): string[] {
  const segments = filePath.split("/").filter((s) => s.length > 0);
  if (segments.length <= 1) {
    return [];
  }
  const folders: string[] = [];
  let acc = segments[0]!;
  folders.push(acc);
  for (let i = 1; i < segments.length - 1; i++) {
    acc = `${acc}/${segments[i]!}`;
    folders.push(acc);
  }
  return folders;
}

async function ensureAncestors(adapter: ObsidianDataAdapter, filePath: string): Promise<void> {
  if (typeof adapter.mkdir !== "function") return;
  for (const folder of ancestorFolders(filePath)) {
    if (!(await adapter.exists(folder))) {
      try {
        await adapter.mkdir(folder);
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    }
  }
}

function isAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  return candidate.code === "EEXIST" || candidate.status === 409 ||
    (typeof candidate.message === "string" && /\bEEXIST\b|already exists/i.test(candidate.message));
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown };
  return candidate.code === "ENOENT" || candidate.status === 404 ||
    (typeof candidate.message === "string" && /\bENOENT\b|not found|does not exist/i.test(candidate.message));
}

export class ObsidianVaultFs implements VaultFs {
  constructor(private adapter: ObsidianDataAdapter) {}

  async exists(p: string): Promise<boolean> {
    assertIrInternalPath(p);
    try {
      return await this.adapter.exists(p);
    } catch (error) {
      // Capacitor / iCloud adapters throw on missing hidden paths instead
      // of returning false. Treat that as absent so ledger init can proceed.
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  read(p: string): Promise<string> {
    assertIrInternalPath(p);
    return this.adapter.read(p);
  }

  async write(p: string, data: string): Promise<void> {
    assertIrInternalPath(p);
    await ensureAncestors(this.adapter, p);
    await this.adapter.write(p, data);
  }

  async writeBatch(
    entries: ReadonlyArray<{ path: string; data: string }>,
  ): Promise<Array<{ path: string; error: unknown }>> {
    if (entries.length === 0) return [];
    for (const entry of entries) {
      assertIrInternalPath(entry.path);
    }
    if (typeof this.adapter.mkdir === "function") {
      const uniqueAncestors = new Set<string>();
      for (const entry of entries) {
        for (const folder of ancestorFolders(entry.path)) {
          uniqueAncestors.add(folder);
        }
      }
      const ordered = [...uniqueAncestors].sort(
        (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
      );
      for (const folder of ordered) {
        if (!(await this.exists(folder))) {
          try {
            await this.adapter.mkdir(folder);
          } catch (error) {
            if (!isAlreadyExists(error)) throw error;
          }
        }
      }
    }
    const failures: Array<{ path: string; error: unknown }> = [];
    for (const entry of entries) {
      try {
        await this.adapter.write(entry.path, entry.data);
      } catch (error) {
        failures.push({ path: entry.path, error });
      }
    }
    return failures;
  }

  async append(p: string, data: string): Promise<void> {
    assertIrInternalPath(p);
    await ensureAncestors(this.adapter, p);
    await this.adapter.append(p, data);
  }

  async list(dir: string): Promise<string[]> {
    assertIrInternalPath(dir);
    try {
      const { files } = await this.adapter.list(dir);
      return files;
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async remove(p: string): Promise<void> {
    assertIrInternalPath(p);
    if (typeof this.adapter.remove !== "function") return;
    try {
      await this.adapter.remove(p);
    } catch (error) {
      // missing path: resolve without throwing
      if (!isNotFound(error)) throw error;
    }
  }
}
