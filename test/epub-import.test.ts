import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { readZipEntries } from "../src/ir/zip-read";
import { planEpubImport, planHtmlImport } from "../src/ir/epub-import";
import type { DeviceId } from "../src/ir/ids";

function buildZipFromStrings(files: Record<string, string | Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const compressed = new Uint8Array(deflateRawSync(raw));
    const nameBytes = enc.encode(name);

    const local = new Uint8Array(30 + nameBytes.byteLength + compressed.byteLength);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, compressed.byteLength, true);
    lv.setUint32(22, raw.byteLength, true);
    lv.setUint16(26, nameBytes.byteLength, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.byteLength);
    localParts.push(local);

    const cd = new Uint8Array(46 + nameBytes.byteLength);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, compressed.byteLength, true);
    cv.setUint32(24, raw.byteLength, true);
    cv.setUint16(28, nameBytes.byteLength, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);

    offset += local.byteLength;
    count += 1;
  }

  const cdOffset = offset;
  const cdSize = cdParts.reduce((s, p) => s + p.byteLength, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, count, true);
  ev.setUint16(10, count, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);

  const out = new Uint8Array(cdOffset + cdSize + 22);
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

const DEVICE = "dev-test" as DeviceId;
const NOW = 1_700_000_000_000;

test("planEpubImport parses EPUB 2 NCX container, builds Book + Chapter tree, links, and attachments", async () => {
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const epubBytes = buildZipFromStrings({
    "META-INF/container.xml": `<?xml version="1.0"?>
      <container version="1.0">
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`,
    "OEBPS/content.opf": `<package version="2.0">
      <metadata>
        <dc:title>Deep Work</dc:title>
        <dc:creator>Cal Newport</dc:creator>
        <dc:language>en</dc:language>
      </metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="img1" href="images/diagram.png" media-type="image/png"/>
      </manifest>
      <spine toc="ncx">
        <itemref idref="ch1"/>
        <itemref idref="ch2"/>
      </spine>
    </package>`,
    "OEBPS/toc.ncx": `<ncx version="2005-1">
      <navMap>
        <navPoint id="n1"><navLabel><text>Part I: The Idea</text></navLabel><content src="text/ch1.xhtml"/></navPoint>
        <navPoint id="n2"><navLabel><text>Part II: The Rules</text></navLabel><content src="text/ch2.xhtml#start"/></navPoint>
      </navMap>
    </ncx>`,
    "OEBPS/text/ch1.xhtml": `<html><body>
      <p>Focus matters deeply. See <a href="ch2.xhtml#start">the rules</a>.</p>
      <p><img src="../images/diagram.png" alt="Diagram"/></p>
    </body></html>`,
    "OEBPS/text/ch2.xhtml": `<html><body><h2>Rule 1</h2><p>Work deeply every day.</p></body></html>`,
    "OEBPS/images/diagram.png": pngBytes,
  });

  const zipEntries = await readZipEntries(epubBytes);
  const plan = planEpubImport({
    zipEntries,
    extractFolder: "Reading",
    attachmentFolder: "Reading/attachments",
    defaultPriority: 40,
    now: NOW,
    deviceId: DEVICE,
    rng: () => 0.5,
  });

  assert.equal(plan.bookTitle, "Deep Work");
  assert.equal(plan.author, "Cal Newport");
  assert.equal(plan.notes.length, 3);
  const [book, ch1, ch2] = plan.notes;
  assert.equal(book!.role, "book");
  assert.equal(book!.parentId, null);
  assert.equal(book!.path, "Reading/Deep Work/Deep Work.md");
  assert.ok(book!.markdown.includes("- **Author:** Cal Newport"));
  assert.ok(book!.markdown.includes(`[[${ch1!.path}|Part I: The Idea]]`));
  assert.ok(book!.markdown.includes(`[[${ch2!.path}|Part II: The Rules]]`));

  assert.equal(ch1!.role, "chapter");
  assert.equal(ch1!.parentId, book!.elementId);
  assert.equal(ch1!.title, "Part I: The Idea");
  assert.ok(ch1!.markdown.includes(`[[${ch2!.path}|the rules]]`));
  assert.ok(ch1!.markdown.includes("![[Reading/attachments/Deep Work/diagram.png]]"));

  assert.equal(ch2!.role, "chapter");
  assert.equal(ch2!.parentId, book!.elementId);
  assert.ok(ch2!.markdown.includes("## Rule 1"));

  assert.equal(plan.attachments.length, 1);
  assert.equal(plan.attachments[0]!.vaultPath, "Reading/attachments/Deep Work/diagram.png");
  assert.deepEqual(plan.attachments[0]!.bytes, pngBytes);
  assert.equal(plan.events.length, 3);
  assert.equal((plan.events[1]!.payload.element as { parentId: string }).parentId, book!.elementId);
});

test("planEpubImport supports EPUB 3 nav TOC and deduplicates colliding paths", async () => {
  const enc = new TextEncoder();
  const entries = new Map<string, Uint8Array>([
    ["META-INF/container.xml", enc.encode('<container><rootfiles><rootfile full-path="package.opf"/></rootfiles></container>')],
    ["package.opf", enc.encode(`<package version="3.0">
      <metadata><dc:title>Book Three</dc:title></metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
        <item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`)],
    ["nav.xhtml", enc.encode('<html><body><nav epub:type="toc"><ol><li><a href="c1.xhtml">Intro</a></li></ol></nav></body></html>')],
    ["c1.xhtml", enc.encode("<html><body><p>Hello EPUB 3.</p></body></html>")],
  ]);

  const plan = planEpubImport({
    zipEntries: entries,
    extractFolder: "IR",
    defaultPriority: 30,
    now: NOW,
    deviceId: DEVICE,
    existingPaths: new Set(["IR/Book Three/Book Three.md"]),
  });

  assert.equal(plan.bookPath, "IR/Book Three/Book Three 2.md");
  assert.equal(plan.notes[1]!.title, "Intro");
  assert.equal(plan.notes[1]!.path, "IR/Book Three/01 - Intro.md");
});

test("planHtmlImport converts standalone HTML into a topic note and ledger event", () => {
  const plan = planHtmlImport({
    html: "<html><head><title>Web Article</title></head><body><h1>Ignored Duplicate?</h1><p>Body paragraph.</p></body></html>",
    fileName: "saved-page.htm",
    extractFolder: "Inbox",
    defaultPriority: 50,
    now: NOW,
    deviceId: DEVICE,
  });

  assert.equal(plan.title, "Web Article");
  assert.equal(plan.path, "Inbox/Web Article.md");
  assert.ok(plan.markdown.includes("Body paragraph."));
  assert.equal(plan.frontmatter["ir-type"], "topic");
  assert.equal(plan.event.kind, "element-created");
  assert.equal(plan.event.target, plan.elementId);
});
