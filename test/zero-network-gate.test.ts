import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/check-zero-network.mjs";

function runGate(content: string): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "ir-gate-"));
  const file = join(dir, "bundle.js");
  writeFileSync(file, content);
  try {
    const out = execFileSync("node", [SCRIPT, file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { code: err.status ?? 1, out: err.stderr ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("gate passes a clean bundle", () => {
  const r = runGate("const x = 1; function schedule(){ return x; }");
  assert.equal(r.code, 0);
  assert.match(r.out, /clean/);
});

test("gate fails on every banned network token", () => {
  const dirty = [
    'fetch("x")',
    "new XMLHttpRequest()",
    'new WebSocket("y")',
    "requestUrl({})",
    "navigator.sendBeacon(u)",
    "new EventSource(u)",
    "new Image(3)",
    "importScripts(u)",
    "new RTCPeerConnection()",
    '"https://example.com"',
    '"http://example.com"',
  ];
  for (const snippet of dirty) {
    const r = runGate(`const a = 1; ${snippet};`);
    assert.equal(r.code, 1, `should fail on: ${snippet}`);
    assert.match(r.out, /zero-network gate FAILED/);
  }
});

test("gate reports the token and a context excerpt", () => {
  const r = runGate('const leak = fetch("https://evil.example/x");');
  assert.match(r.out, /fetch\(/);
  assert.match(r.out, /evil\.example/);
});
