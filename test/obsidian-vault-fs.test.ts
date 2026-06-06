/**
 * Golden contract for src/ir/obsidian-vault-fs.ts (the VaultFs port over
 * Obsidian's data adapter).
 *
 * Claude-authored, fenced out of the delegated scope. No Obsidian import:
 * the oracle drives a fake data adapter that mimics the one real behavior
 * that matters — a write/append fails if the parent folder is missing. The
 * delegated agent implements src/ir/obsidian-vault-fs.ts ONLY and is judged
 * solely by this suite + the rest of the suite staying green + tsc. Do not
 * edit this file to pass.
 *
 * Contract under test
 * -------------------
 *  - export interface ObsidianDataAdapter with: exists, read, write,
 *    append, list (-> { files: string[]; folders: string[] }), remove,
 *    mkdir.
 *  - export class ObsidianVaultFs implements VaultFs, constructed from an
 *    ObsidianDataAdapter.
 *      * write/append create every missing ancestor folder (root to leaf)
 *        before delegating, and do not re-mkdir folders that already exist.
 *      * list(dir) returns adapter.list(dir).files (full vault-relative
 *        paths); a missing dir yields [].
 *      * exists/read delegate directly.
 *      * remove delegates but never throws on a missing path.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ObsidianVaultFs,
  type ObsidianDataAdapter,
} from "../src/ir/obsidian-vault-fs";
import type { VaultFs } from "../src/ir/store";

function fakeAdapter(): ObsidianDataAdapter & {
  calls: string[];
  files: Map<string, string>;
  folders: Set<string>;
} {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const calls: string[] = [];
  const parent = (p: string) => p.split("/").slice(0, -1).join("/");
  return {
    calls,
    files,
    folders,
    async exists(p: string) {
      calls.push(`exists ${p}`);
      return files.has(p) || folders.has(p);
    },
    async read(p: string) {
      calls.push(`read ${p}`);
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async write(p: string, data: string) {
      calls.push(`write ${p}`);
      const dir = parent(p);
      if (dir && !folders.has(dir)) throw new Error(`ENOENT dir ${dir}`);
      files.set(p, data);
    },
    async append(p: string, data: string) {
      calls.push(`append ${p}`);
      const dir = parent(p);
      if (dir && !folders.has(dir)) throw new Error(`ENOENT dir ${dir}`);
      files.set(p, (files.get(p) ?? "") + data);
    },
    async list(p: string) {
      calls.push(`list ${p}`);
      if (p && !folders.has(p)) throw new Error(`ENOENT dir ${p}`);
      const pre = p ? p + "/" : "";
      const f: string[] = [];
      for (const k of files.keys()) {
        if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) f.push(k);
      }
      const d: string[] = [];
      for (const k of folders) {
        if (k.startsWith(pre) && k !== p && !k.slice(pre.length).includes("/")) {
          d.push(k);
        }
      }
      return { files: f, folders: d };
    },
    async remove(p: string) {
      calls.push(`remove ${p}`);
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      files.delete(p);
    },
    async mkdir(p: string) {
      calls.push(`mkdir ${p}`);
      folders.add(p);
    },
    async rmdir(p: string, recursive: boolean) {
      calls.push(`rmdir ${p} ${recursive}`);
      if (!folders.has(p)) throw new Error(`ENOENT dir ${p}`);
      if (recursive) {
        const pre = p + "/";
        for (const k of [...files.keys()]) {
          if (k === p || k.startsWith(pre)) files.delete(k);
        }
        for (const k of [...folders]) {
          if (k === p || k.startsWith(pre)) folders.delete(k);
        }
      } else {
        folders.delete(p);
      }
    },
  };
}

test("ObsidianVaultFs is assignable to VaultFs", () => {
  const fs: VaultFs = new ObsidianVaultFs(fakeAdapter());
  assert.ok(fs);
});

test("write creates every missing ancestor folder, root to leaf, once", async () => {
  const a = fakeAdapter();
  const fs = new ObsidianVaultFs(a);

  await fs.write(".ir/log/dev1.jsonl", "line1\n");
  assert.equal(a.files.get(".ir/log/dev1.jsonl"), "line1\n");

  const mkdirs = a.calls.filter((c) => c.startsWith("mkdir "));
  assert.deepEqual(
    mkdirs,
    ["mkdir .ir", "mkdir .ir/log"],
    "ancestors created root-to-leaf before the write",
  );

  // A second write under existing folders must not re-mkdir them.
  const before = a.calls.length;
  await fs.write(".ir/log/dev2.jsonl", "x\n");
  const newMkdirs = a.calls
    .slice(before)
    .filter((c) => c.startsWith("mkdir "));
  assert.deepEqual(newMkdirs, [], "existing folders are not re-created");
  assert.equal(a.files.get(".ir/log/dev2.jsonl"), "x\n");
});

test("append ensures parents then appends; repeated append concatenates", async () => {
  const a = fakeAdapter();
  const fs = new ObsidianVaultFs(a);

  await fs.append(".ir/log/dev.jsonl", "a\n");
  await fs.append(".ir/log/dev.jsonl", "b\n");
  assert.equal(a.files.get(".ir/log/dev.jsonl"), "a\nb\n");
  assert.ok(
    a.calls.includes("mkdir .ir") && a.calls.includes("mkdir .ir/log"),
    "append created the missing parent chain",
  );
});

test("list returns full file paths and ignores folders; missing dir -> []", async () => {
  const a = fakeAdapter();
  const fs = new ObsidianVaultFs(a);
  await fs.write(".ir/log/d1.jsonl", "1");
  await fs.write(".ir/log/d2.jsonl", "2");
  await a.mkdir(".ir/log/nested");

  const listed = (await fs.list(".ir/log")).sort();
  assert.deepEqual(listed, [".ir/log/d1.jsonl", ".ir/log/d2.jsonl"]);
  assert.deepEqual(await fs.list(".ir/state"), [], "missing dir yields []");
});

test("exists and read delegate to the adapter", async () => {
  const a = fakeAdapter();
  const fs = new ObsidianVaultFs(a);
  await fs.write(".ir/meta.json", '{"schemaVersion":1}');
  assert.equal(await fs.exists(".ir/meta.json"), true);
  assert.equal(await fs.exists(".ir/missing.json"), false);
  assert.equal(await fs.read(".ir/meta.json"), '{"schemaVersion":1}');
});

test("remove deletes an existing path and is a silent no-op when absent", async () => {
  const a = fakeAdapter();
  const fs = new ObsidianVaultFs(a);
  await fs.write(".ir/state/x.json", "{}");
  await fs.remove(".ir/state/x.json");
  assert.equal(a.files.has(".ir/state/x.json"), false);
  await assert.doesNotReject(
    fs.remove(".ir/state/never-existed.json"),
    "remove tolerates a missing path",
  );
});
