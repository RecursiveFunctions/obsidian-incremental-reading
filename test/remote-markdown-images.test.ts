import assert from "node:assert/strict";
import { test } from "node:test";
import {
  htmlToMarkdown,
  stripRemoteMarkdownImages,
} from "../src/ir/html-to-markdown";
import {
  exportSuperMemoXmlCollection,
  parseSuperMemoQaText,
  parseSuperMemoXmlCollection,
} from "../src/ir/sm20-exchange";
import { newDeviceId, newElementId } from "../src/ir/ids";
import { newElement } from "../src/ir/model";

const NOW = 1_760_000_000_000;
const DEV = newDeviceId();
const BEACON = "https://tracker.invalid/pixel.png?uid=iraudit";

test("htmlToMarkdown strips a remote markdown image arriving as plain text", () => {
  const out = htmlToMarkdown(`<p>Question ![](${BEACON}) here</p>`);
  assert.equal(out.includes(BEACON), false);
  assert.match(out, /Question/);
});

test("Q&A import strips a remote markdown image from a plain Q line", () => {
  const parsed = parseSuperMemoQaText(
    [`Q: See ![](${BEACON})`, "A: answer"].join("\n"),
    NOW,
    DEV,
  );
  assert.equal(parsed.elements.length, 1);
  assert.equal(parsed.elements[0]!.text.includes(BEACON), false);
});

test("XML import strips a remote markdown image from a plain Question", () => {
  const id = newElementId();
  const el = {
    ...newElement({ id, type: "item" as const, priority: 50, now: NOW }),
    text: `Question ![](${BEACON})\n\n{{c1::answer}}`,
  };
  const xml = exportSuperMemoXmlCollection([el]);
  const imported = parseSuperMemoXmlCollection(xml, NOW, DEV);
  assert.equal(imported.elements.length, 1);
  assert.equal(imported.elements[0]!.text.includes(BEACON), false);
});

test("stripRemoteMarkdownImages preserves local, wikilink, data, and code embeds", () => {
  const md = [
    `![](https://tracker.invalid/a.png)`,
    `![](${BEACON})`,
    "![](media/diagram.png)",
    "![[Note.png]]",
    "![](data:image/png;base64,AAAA)",
    "```md",
    `![](${BEACON})`,
    "```",
  ].join("\n");
  const out = stripRemoteMarkdownImages(md);
  assert.equal(out.includes("tracker.invalid"), true, "code example is preserved");
  assert.equal(out.includes("media/diagram.png"), true);
  assert.equal(out.includes("![[Note.png]]"), true);
  assert.equal(out.includes("data:image/png"), true);
  assert.equal(out.split(BEACON).length - 1, 1, "only the code example remains");
});
