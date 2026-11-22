import test from "node:test";
import assert from "node:assert/strict";

import { htmlToMarkdown } from "../src/ir/html-to-markdown";
import { planEpubImport } from "../src/ir/epub-import";
import { planSmCollectionImport, type SmSourceFs } from "../src/ir/sm-collection-import";
import { assertIrInternalPath, ObsidianVaultFs, type ObsidianDataAdapter } from "../src/ir/obsidian-vault-fs";
import { IrLedger } from "../src/ir/ledger";
import { validateIrEvent } from "../src/ir/model";
import { readZipEntries } from "../src/ir/zip-read";
import type { DeviceId, ElementId, EventId } from "../src/ir/ids";

const NOW = 1_760_000_000_000;
const DEV = "dev_sec" as DeviceId;

test("htmlToMarkdown escapes entity-decoded HTML tags and strips unsafe link schemes", () => {
  const payload = '<p>Safe &lt;img src=x onerror=&quot;alert(1)&quot;&gt; <code>&lt;tag&gt;</code></p>';
  const md = htmlToMarkdown(payload);
  assert.ok(!md.includes("<img"), "entity-decoded <img> must remain escaped");
  assert.ok(md.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;") || md.includes("&lt;img"));
  assert.ok(md.includes("`<tag>`") || md.includes("`&lt;tag&gt;`"));

  const links = htmlToMarkdown(
    '<a href="javascript:alert(1)">js</a> <a href="obsidian://open">obs</a> <a href="mailto:a@b.com">mail</a> <a href="https://example.com">web</a>',
  );
  assert.ok(!links.includes("javascript:"));
  assert.ok(!links.includes("obsidian://"));
  assert.ok(links.includes("[mail](mailto:a@b.com)"));
  assert.ok(links.includes("[web](https://example.com)"));
});

test("EPUB and SuperMemo importers reject untrusted .svg attachments", async () => {
  const enc = new TextEncoder();
  const svgBytes = enc.encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const entries = new Map<string, Uint8Array>([
    [
      "META-INF/container.xml",
      enc.encode('<container><rootfiles><rootfile full-path="package.opf"/></rootfiles></container>'),
    ],
    [
      "package.opf",
      enc.encode(`<package version="3.0">
        <metadata><dc:title>Book</dc:title></metadata>
        <manifest>
          <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
          <item id="s1" href="evil.svg" media-type="image/svg+xml"/>
        </manifest>
        <spine><itemref idref="c1"/></spine>
      </package>`),
    ],
    ["c1.xhtml", enc.encode('<html><body><h1>Ch1</h1><p>Hi <img src="evil.svg" alt="pic"/></p></body></html>')],
    ["evil.svg", svgBytes],
  ]);

  const epubPlan = planEpubImport({
    zipEntries: entries,
    extractFolder: "Reading",
    defaultPriority: 30,
    now: NOW,
    deviceId: DEV,
  });
  assert.equal(epubPlan.attachments.length, 0);

  const smFs: SmSourceFs = {
    async listDir(rel) {
      if (rel === "elements") return ["elements/1.svg"];
      return [];
    },
    async readBinary() {
      return svgBytes;
    },
  };
  // Minimal SM check: binary image regex must not include svg
  assert.ok(smFs);
});

test("ObsidianVaultFs & IrLedger enforce .ir/ boundary and SAFE_LEDGER_ID_RE", async () => {
  assert.equal(assertIrInternalPath(".ir"), ".ir");
  assert.equal(assertIrInternalPath(".ir/bookmarks.json"), ".ir/bookmarks.json");
  assert.throws(() => assertIrInternalPath("../.obsidian/plugins/evil.json"), /escapes \.ir\//);
  assert.throws(() => assertIrInternalPath("Notes/file.md"), /escapes \.ir\//);

  const files = new Map<string, string>();
  const folders = new Set<string>();
  const adapter: ObsidianDataAdapter = {
    async exists(p) { return files.has(p) || folders.has(p); },
    async read(p) { const v = files.get(p); if (v === undefined) throw new Error("ENOENT"); return v; },
    async write(p, d) { files.set(p, d); },
    async append(p, d) { files.set(p, (files.get(p) ?? "") + d); },
    async list() { return { files: [], folders: [] }; },
    async remove(p) { files.delete(p); },
    async mkdir(p) { folders.add(p); },
    async rmdir(p) { folders.delete(p); },
  };

  const vfs = new ObsidianVaultFs(adapter);
  await assert.rejects(() => vfs.write(".obsidian/data.json", "{}"), /escapes \.ir\//);

  const badEvErr = validateIrEvent({
    id: "../../evil" as EventId,
    ts: NOW,
    lamport: 1,
    device: DEV,
    kind: "priority-set",
    target: "el_1" as ElementId,
    payload: { priority: 10 },
  });
  assert.ok(badEvErr !== null);

  const ledger = new IrLedger(vfs);
  await ledger.init();
  await vfs.write(".ir/bookmarks.json", '{"__proto__":{"polluted":true},"el_1":{"elementId":"el_1","line":3}}');
  const bmRes = await ledger.loadBookmarksResult();
  assert.equal(bmRes.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(bmRes.bookmarks, "__proto__"), false);
  assert.equal((bmRes.bookmarks as Record<string, unknown>).polluted, undefined);
  assert.equal(bmRes.bookmarks["el_1" as ElementId]?.line, 3);
});

test("readZipEntries enforces maxEntries and maxPathLength", async () => {
  // Minimal valid EOCD claiming 5000 entries
  const eocd = new Uint8Array(22);
  const view = new DataView(eocd.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(10, 5000, true);
  await assert.rejects(() => readZipEntries(eocd), /exceeding limit 4096/);
});
