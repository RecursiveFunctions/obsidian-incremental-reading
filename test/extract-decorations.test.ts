import { test } from "node:test";
import assert from "node:assert/strict";
import {
  imageTargetsInText,
  nthOccurrenceOffset,
  occurrenceIndexInSource,
  paintIrSourceMarksInElement,
  readingViewNeedle,
  readingViewNeedleBlocks,
  readingViewNeedlePasses,
} from "../src/ir/extract-reading-marks";

test("readingViewNeedlePasses: skips short needles, keeps duplicate quotes", () => {
  const passes = readingViewNeedlePasses([
    { text: "ab" },
    { text: "  first quote  " },
    { text: "first quote" },
    { text: "other passage here" },
  ]);
  assert.deepEqual(passes, [
    { needle: "first quote", n: 0 },
    { needle: "first quote", n: 1 },
    { needle: "other passage here", n: 0 },
  ]);
});

test("readingViewNeedle: strips markdown emphasis so rendered text matches", () => {
  assert.equal(readingViewNeedle("**bold phrase here**"), "bold phrase here");
  assert.equal(readingViewNeedle("_italic span ok_"), "italic span ok");
  assert.equal(readingViewNeedle("ab"), "");
});

test("readingViewNeedlePasses: markdown-wrapped quotes normalize to one needle", () => {
  const passes = readingViewNeedlePasses([
    { text: "**same words here**" },
    { text: "same words here" },
  ]);
  assert.deepEqual(passes, [
    { needle: "same words here", n: 0 },
    { needle: "same words here", n: 1 },
  ]);
});

test("nthOccurrenceOffset: second identical quote is a later index", () => {
  const hay = "the cat sat on the mat";
  assert.equal(nthOccurrenceOffset(hay, "the", 0), 0);
  assert.equal(nthOccurrenceOffset(hay, "the", 1), hay.lastIndexOf("the"));
  assert.equal(nthOccurrenceOffset(hay, "the", 2), -1);
});

test("readingViewNeedleBlocks: splits a multi-block extract into per-block needles", () => {
  const blocks = readingViewNeedleBlocks(
    "Alpha paragraph text.\n\nBeta paragraph text.",
  );
  assert.deepEqual(
    blocks.map((b) => b.needle),
    ["Alpha paragraph text.", "Beta paragraph text."],
  );
});

test("readingViewNeedleBlocks: strips list chrome the renderer never shows", () => {
  const blocks = readingViewNeedleBlocks(
    "- first bullet here\n- second bullet here",
  );
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0]!.lines, [
    "first bullet here",
    "second bullet here",
  ]);
});

test("readingViewNeedleBlocks: strips blockquote, ordered-list, and heading chrome", () => {
  assert.deepEqual(
    readingViewNeedleBlocks("> quoted line here")[0]!.lines,
    ["quoted line here"],
  );
  assert.deepEqual(
    readingViewNeedleBlocks("1. numbered line here")[0]!.lines,
    ["numbered line here"],
  );
  // `#` is already dropped as emphasis chrome, so the heading needle and its
  // line needle agree and no separate line fallback is recorded.
  assert.deepEqual(readingViewNeedleBlocks("## Heading here"), [
    { needle: "Heading here", lines: [] },
  ]);
});

test("readingViewNeedleBlocks: a single plain paragraph needs no line fallback", () => {
  assert.deepEqual(readingViewNeedleBlocks("one plain paragraph"), [
    { needle: "one plain paragraph", lines: [] },
  ]);
});

test("readingViewNeedle: flattens link syntax to what the renderer shows", () => {
  assert.equal(
    readingViewNeedle("[the anchor guide](https://example.com/anchors)"),
    "the anchor guide",
  );
  assert.equal(readingViewNeedle("see [[Notes|the notes]] later"), "see the notes later");
  assert.equal(readingViewNeedle("see [[Notes]] later"), "see Notes later");
  assert.equal(readingViewNeedle("figure ![alt text](img.png) here"), "figure here");
});

test("occurrenceIndexInSource: counts the twins before the span", () => {
  const body = [
    "Zeta says the tuning knob is repeated verbatim.",
    "",
    "Eta says the tuning knob is repeated verbatim.",
  ].join("\n");
  const needle = "the tuning knob is repeated verbatim.";
  const first = body.indexOf(needle);
  const second = body.indexOf(needle, first + 1);
  assert.equal(occurrenceIndexInSource(body, first, needle), 0);
  assert.equal(occurrenceIndexInSource(body, second, needle), 1);
});

test("occurrenceIndexInSource: counts through link chrome the renderer hides", () => {
  const body = "see [the guide](https://x.y) then see the guide again";
  const second = body.indexOf("the guide", 20);
  assert.equal(occurrenceIndexInSource(body, second, "the guide"), 1);
});

test("imageTargetsInText: finds embeds and markdown images", () => {
  assert.deepEqual(imageTargetsInText("text ![[figure.png]] more"), ["figure.png"]);
  assert.deepEqual(imageTargetsInText("![[a.png|300]] and ![alt](sub/b.png)"), [
    "a.png",
    "sub/b.png",
  ]);
  assert.deepEqual(imageTargetsInText("no images here"), []);
});

test("paintIrSourceMarksInElement: highlights heading+body extract across blocks without hitting earlier prose", () => {
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const prevNF = (globalThis as Record<string, unknown>).NodeFilter;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
  const prevNode = (globalThis as Record<string, unknown>).Node;

  interface DomNode {
    nodeType: number;
    parentNode: DomEl | null;
    nodeValue?: string;
    tagName?: string;
    className?: string;
    textContent?: string | null;
    childNodes: DomNode[];
  }
  class FakeEl implements DomNode {
    nodeType = 1;
    parentNode: DomEl | null = null;
    tagName: string;
    className = "";
    childNodes: DomNode[] = [];
    classList = {
      contains: (c: string) => this.className.split(/\s+/).includes(c),
      add: (...cs: string[]) => {
        for (const c of cs) if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim();
      },
    };
    constructor(tag: string) { this.tagName = tag.toUpperCase(); }
    appendChild(n: DomNode) {
      n.parentNode = this;
      this.childNodes.push(n);
      return n;
    }
    insertBefore(n: DomNode, ref: DomNode | null) {
      n.parentNode = this;
      const idx = ref ? this.childNodes.indexOf(ref) : -1;
      if (idx === -1) this.childNodes.push(n);
      else this.childNodes.splice(idx, 0, n);
      return n;
    }
    removeChild(n: DomNode) {
      const idx = this.childNodes.indexOf(n);
      if (idx !== -1) this.childNodes.splice(idx, 1);
      n.parentNode = null;
      return n;
    }
    querySelectorAll() { return []; }
  }
  type DomEl = FakeEl;
  const textNode = (v: string): DomNode => ({ nodeType: 3, parentNode: null, nodeValue: v, childNodes: [] });

  (globalThis as Record<string, unknown>).Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };
  (globalThis as Record<string, unknown>).NodeFilter = { SHOW_TEXT: 4 };
  (globalThis as Record<string, unknown>).HTMLElement = FakeEl;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => new FakeEl(tag),
    createTextNode: (v: string) => textNode(v),
    createTreeWalker: (root: DomEl) => {
      const list: DomNode[] = [];
      const walk = (n: DomNode) => {
        if (n.nodeType === 3) list.push(n);
        for (const c of n.childNodes) walk(c);
      };
      walk(root);
      let i = -1;
      return {
        nextNode: () => {
          i += 1;
          return list[i] ?? null;
        },
      };
    },
  };

  try {
    const root = new FakeEl("DIV");
    const pIntro = new FakeEl("P");
    pIntro.appendChild(textNode("See examples below."));
    const h2 = new FakeEl("H2");
    h2.appendChild(textNode("examples"));
    const pBody = new FakeEl("P");
    pBody.appendChild(textNode("First example line."));
    root.appendChild(pIntro);
    root.appendChild(h2);
    root.appendChild(pBody);

    paintIrSourceMarksInElement(root as unknown as HTMLElement, [
      { text: "## examples\n\nFirst example line.", cls: "ir-extract-source", occurrence: 0 },
    ]);

    const hasMark = (el: FakeEl) => el.childNodes.some((c) => c instanceof FakeEl && c.tagName === "MARK");
    assert.equal(hasMark(pIntro), false);
    assert.equal(hasMark(h2), true);
    assert.equal(hasMark(pBody), true);
  } finally {
    (globalThis as Record<string, unknown>).document = prevDoc;
    (globalThis as Record<string, unknown>).NodeFilter = prevNF;
    (globalThis as Record<string, unknown>).HTMLElement = prevHTMLElement;
    (globalThis as Record<string, unknown>).Node = prevNode;
  }
});
