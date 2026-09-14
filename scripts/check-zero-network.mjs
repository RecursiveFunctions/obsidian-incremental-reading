/**
 * Zero-network gate. Fails the build if the compiled bundle contains any
 * network-capable API or a remote URL literal. This is what turns the
 * README's privacy section from a promise into a property: the check runs
 * in `npm run build`, so every local build, every CI run and every release
 * artifact passes through it. See SECURITY.md.
 *
 * Usage: node scripts/check-zero-network.mjs [path-to-bundle]
 */

import { readFileSync } from "node:fs";

const target = process.argv[2] ?? "main.js";

// Substrings, not regexes: what a human would grep for. Each one is an
// API that can move data off the machine, plus URL literals as a tripwire
// (today's bundle contains zero; adding one should be a conscious edit
// here with a written reason).
const BANNED = [
  "fetch(",
  "XMLHttpRequest",
  "WebSocket",
  "requestUrl",
  "sendBeacon",
  "EventSource",
  "new Image(",
  "importScripts(",
  "RTCPeerConnection",
  "RTCDataChannel",
  "http://",
  "https://",
];

const src = readFileSync(target, "utf8");
const hits = [];
for (const token of BANNED) {
  let idx = src.indexOf(token);
  let count = 0;
  let first = -1;
  while (idx !== -1) {
    if (first === -1) first = idx;
    count++;
    idx = src.indexOf(token, idx + token.length);
  }
  if (count > 0) {
    const context = src
      .slice(Math.max(0, first - 40), first + token.length + 40)
      .replace(/\s+/g, " ");
    hits.push({ token, count, context });
  }
}

if (hits.length > 0) {
  console.error(`zero-network gate FAILED for ${target}:`);
  for (const h of hits) {
    console.error(`  ${h.token}  x${h.count}  ...${h.context}...`);
  }
  console.error(
    "The shipped bundle must contain no network-capable code. If a hit is a false positive, allowlist it here with a written reason.",
  );
  process.exit(1);
}

console.log(
  `zero-network gate: clean (${BANNED.length} tokens checked, 0 hits in ${target})`,
);
