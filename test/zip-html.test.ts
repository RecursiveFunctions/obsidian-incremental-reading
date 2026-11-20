import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readZipEntries } from "../src/ir/zip-read";
import { htmlToMarkdown } from "../src/ir/html-to-markdown";

interface ZipInputEntry {
  name: string;
  data: Uint8Array;
  method: 0 | 8;
  declareUncompressedSize?: number;
}

function buildZip(entries: ZipInputEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const compressed =
      entry.method === 0 ? entry.data : new Uint8Array(deflateRawSync(entry.data));
    const uncompSize = entry.declareUncompressedSize ?? entry.data.byteLength;

    const local = new Uint8Array(30 + nameBytes.byteLength + compressed.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, entry.method, true);
    lv.setUint32(18, compressed.byteLength, true);
    lv.setUint32(22, uncompSize, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.byteLength);
    localParts.push(local);

    const cd = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, entry.method, true);
    cv.setUint32(20, compressed.byteLength, true);
    cv.setUint32(24, uncompSize, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);

    offset += local.byteLength;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of cdParts) cdSize += c.byteLength;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const totalLen = cdOffset + cdSize + eocd.byteLength;
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const l of localParts) {
    out.set(l, pos);
    pos += l.byteLength;
  }
  for (const c of cdParts) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  out.set(eocd, pos);
  return out;
}

test("readZipEntries decodes stored and deflate-raw entries and normalizes paths", async () => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const zip = buildZip([
    { name: "mimetype", data: enc.encode("application/epub+zip"), method: 0 },
    { name: "OEBPS\\chapter1.xhtml", data: enc.encode("<p>Hello EPUB world!</p>".repeat(20)), method: 8 },
    { name: "OEBPS/sub/", data: new Uint8Array(0), method: 0 },
  ]);

  const map = await readZipEntries(zip);
  assert.equal(map.size, 2);
  assert.equal(dec.decode(map.get("mimetype")), "application/epub+zip");
  assert.equal(dec.decode(map.get("OEBPS/chapter1.xhtml")), "<p>Hello EPUB world!</p>".repeat(20));
});

test("readZipEntries enforces per-entry and total zip-bomb byte caps", async () => {
  const enc = new TextEncoder();
  const payload = enc.encode("A".repeat(4096));
  const zip = buildZip([
    { name: "big.txt", data: payload, method: 8, declareUncompressedSize: 100 },
  ]);

  await assert.rejects(
    () => readZipEntries(zip, { maxEntryBytes: 1024 }),
    /exceeds maximum uncompressed size/,
  );

  const multiZip = buildZip([
    { name: "a.txt", data: enc.encode("A".repeat(600)), method: 8 },
    { name: "b.txt", data: enc.encode("B".repeat(600)), method: 8 },
  ]);
  await assert.rejects(
    () => readZipEntries(multiZip, { maxEntryBytes: 1024, maxTotalBytes: 1000 }),
    /exceeds maximum total uncompressed size/,
  );
});

test("readZipEntries uses custom inflateRaw fallback cleanly and rejects malformed headers", async () => {
  const enc = new TextEncoder();
  const zip = buildZip([{ name: "x.txt", data: enc.encode("hello"), method: 8 }]);
  let usedCustom = false;
  const map = await readZipEntries(zip, {
    inflateRaw: async () => {
      usedCustom = true;
      return enc.encode("hello");
    },
  });
  assert.equal(usedCustom, true);
  assert.equal(new TextDecoder().decode(map.get("x.txt")), "hello");

  await assert.rejects(() => readZipEntries(new Uint8Array(10)), /smaller than EOCD/);
});

test("htmlToMarkdown converts structure, tables, code, links, and local/SVG image embeds", () => {
  const html = [
    "<head><title>Ignored Head</title><script>alert(1)</script><style>body{color:red}</style></head>",
    "<h1>Chapter One</h1>",
    '<p>Intro with <strong>bold</strong>, <em>italic</em>, and <code>inline &lt;T&gt;</code>.</p>',
    "<blockquote><p>Quoted line 1</p><p>Quoted line 2</p></blockquote>",
    "<ul><li>First bullet</li><li>Second bullet</li></ul>",
    "<ol><li>Step A</li><li>Step B</li></ol>",
    '<pre><code class="language-ts">const x = 1 &lt; 2;\nconsole.log(x);</code></pre>',
    "<table><tr><th>Key</th><th>Val</th></tr><tr><td>A</td><td>1</td></tr></table>",
    '<p><img src="images/fig1.png" alt="Fig 1" /></p>',
    '<svg><image xlink:href="images/cover.jpg" /></svg>',
    '<p>See <a href="ch2.xhtml#sec">Next Chapter</a> and <a href="https://example.com/docs">Docs</a>.</p>',
  ].join("\n");

  const md = htmlToMarkdown(html, {
    resolveAssetPath: (src) => `attachments/${src.split("/").pop()}`,
    resolveLinkTarget: (href) => (href.startsWith("ch2") ? "Book - Chapter 2" : null),
  });

  assert.ok(!md.includes("Ignored Head"));
  assert.ok(!md.includes("alert(1)"));
  assert.ok(md.includes("# Chapter One"));
  assert.ok(md.includes("**bold**"));
  assert.ok(md.includes("*italic*"));
  assert.ok(md.includes("`inline <T>`"));
  assert.ok(md.includes("> Quoted line 1"));
  assert.ok(md.includes("- First bullet"));
  assert.ok(md.includes("1. Step A\n2. Step B"));
  assert.ok(md.includes("```ts\nconst x = 1 < 2;\nconsole.log(x);\n```"));
  assert.ok(md.includes("| Key | Val |\n| --- | --- |\n| A | 1 |"));
  assert.ok(md.includes("![[attachments/fig1.png]]"));
  assert.ok(md.includes("![[attachments/cover.jpg]]"));
  assert.ok(md.includes("[[Book - Chapter 2|Next Chapter]]"));
  assert.ok(md.includes("[Docs](https://example.com/docs)"));
});
