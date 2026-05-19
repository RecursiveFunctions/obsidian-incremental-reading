import type { VaultFs } from "./store";

export interface ObsidianDataAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
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
      await adapter.mkdir(folder);
    }
  }
}

export class ObsidianVaultFs implements VaultFs {
  constructor(private adapter: ObsidianDataAdapter) {}

  exists(p: string): Promise<boolean> {
    return this.adapter.exists(p);
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
    } catch {
      return [];
    }
  }

  async remove(p: string): Promise<void> {
    try {
      await this.adapter.remove(p);
    } catch {
      // missing path: resolve without throwing
    }
  }
}
