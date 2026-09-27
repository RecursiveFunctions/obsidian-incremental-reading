import type { VaultFs } from "./ledger";

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
    return this.adapter.read(p);
  }

  async write(p: string, data: string): Promise<void> {
    await ensureAncestors(this.adapter, p);
    await this.adapter.write(p, data);
  }

  async append(p: string, data: string): Promise<void> {
    await ensureAncestors(this.adapter, p);
    await this.adapter.append(p, data);
  }

  async list(dir: string): Promise<string[]> {
    try {
      const { files } = await this.adapter.list(dir);
      return files;
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  async remove(p: string): Promise<void> {
    try {
      await this.adapter.remove(p);
    } catch (error) {
      // missing path: resolve without throwing
      if (!isNotFound(error)) throw error;
    }
  }
}
