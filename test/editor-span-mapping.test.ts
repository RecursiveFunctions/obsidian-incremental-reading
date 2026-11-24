import { test } from "node:test";
import assert from "node:assert/strict";
import { mapBodySpans, stripFrontmatter } from "../src/ir/frontmatter-body";

const WITH_FM = "---\ntitle: x\n---\n\nAlpha beta\n\nGamma delta\n";

test("mapBodySpans maps every editor range into stripped-body offsets", () => {
  const full = WITH_FM;
  const body = stripFrontmatter(full);
  const ranges = [
    { from: full.indexOf("Alpha"), to: full.indexOf("Alpha") + 5 },
    { from: full.indexOf("Gamma"), to: full.indexOf("Gamma") + 5 },
  ];

  const spans = mapBodySpans(full, ranges);
  assert.equal(spans.length, 2);
  assert.equal(body.slice(spans[0]!.start, spans[0]!.end), "Alpha");
  assert.equal(body.slice(spans[1]!.start, spans[1]!.end), "Gamma");
});

test("mapBodySpans skips ranges that fall outside the body", () => {
  const full = WITH_FM;
  const ranges = [
    { from: full.indexOf("title"), to: full.indexOf("title") + 5 },
    { from: full.indexOf("Alpha"), to: full.indexOf("Alpha") + 5 },
  ];
  assert.equal(mapBodySpans(full, ranges).length, 1);
});
