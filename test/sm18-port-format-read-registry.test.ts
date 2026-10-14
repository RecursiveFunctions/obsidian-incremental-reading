/**
 * Golden contract for the SM-18 format-read port follow-up on the registry
 * chain (sm18-re gitlab #40).
 *
 * Follow-up to #36. v1 landed `parseElementInfo` + `parseCompon`; this lane
 * lands the six-kind registry chain: `text` (via `smfmt.registry_text`) plus
 * `smfmt.registry_payloads.KINDS = (image, template, concept, tasklist,
 * Lexicon)`. Each kind composes `.mem` member records, a `.ptr` pointer
 * list, an optional `.lst` sidecar, and a variable-length `.rtx` payload
 * stream into a `member_number -> span` mapping.
 *
 * The fixture `test/fixtures/sm18-port-format-read-registry.json` is a mirror
 * of `sm18-re:tests/fixtures/port-format-read-registry.json`, regenerated
 * by `sm18-re:scripts/export-port-format-read-registry-fixture.py` on the
 * ABC collection. Cyber is excluded on size.
 *
 * ## Privacy
 *
 * This is the first format-read group that touches user prose. `.mem`, `.ptr`
 * and `.lst` are numeric index files and are inlined whole; `.rtx` is NOT
 * inlined raw — the exporter emits a redacted stream where every byte that
 * is not a `\0` record terminator or a `<IB>` trailer byte is replaced with
 * `0x58` ('X'). The structural layout survives verbatim so a port's
 * `parseRegistryRtx` produces geometrically identical records. Per-member
 * `payload_sha256` of the real payload span is recorded for human audit;
 * the TS harness does NOT read real `.rtx` bytes and must never print a
 * decoded payload.
 *
 * ## Exports the lane adds (additively) to `src/sm18-format-read.ts`
 *
 *   parseRegistryMem(bytes: Uint8Array): RegistryMemRecord[]
 *   parseRegistryPtr(bytes: Uint8Array): number[]
 *   parseRegistryRtx(bytes: Uint8Array): RtxSpan[]
 *   resolveRegistry(opts: {
 *     mem: Uint8Array;
 *     ptr?: Uint8Array;    // required for generic kinds; unused for text
 *     rtx: Uint8Array;
 *     kind: RegistryKind;
 *   }): Map<number, Uint8Array>
 *
 * - `parseRegistryMem` decodes `.mem` as 30-byte records with the
 *   `<I I H H I 8s 6s>` layout from `registry_mem.FIELDS`. The two
 *   byte-string tails are `{hex: string}` blobs.
 * - `parseRegistryPtr` returns one entry per 4-byte word (one-based member
 *   numbers; `0` denotes an empty slot).
 * - `parseRegistryRtx` is the generic walker from `registry_payloads.parse`
 *   — each record is `[payload][\\0][u32 member_number][u8 active]`. On an
 *   incomplete trailer, member_number == 0, or active != 1, the port must
 *   throw (ExternalChain in the Python reference). Returns `RtxSpan[]`
 *   describing stream coordinates — no payload bytes.
 * - `resolveRegistry` is the composition. For `kind === "text"` it walks
 *   `.mem` at stride 30 and slices `.rtx` by the `<II>` position/length at
 *   mem offset `0x0a`; `.ptr` is ignored. For generic kinds it uses `.ptr`
 *   to find live members, then slices `.rtx` the same way. Deleted slots
 *   (position == 0 for text, absent from `.ptr` for generic) are omitted.
 *
 * Error contracts:
 * - parseRegistryMem throws on a byte length not a multiple of 30.
 * - parseRegistryPtr throws on a byte length not a multiple of 4.
 * - parseRegistryRtx throws on an incomplete trailer, member_number == 0,
 *   or active != 1.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_PATH = join(
  __dirname,
  "fixtures",
  "sm18-port-format-read-registry.json",
);
const MODULE_SPEC = ["..", "src", "sm18-format-read.ts"].join("/");

type RegistryKind =
  | "text"
  | "image"
  | "template"
  | "concept"
  | "tasklist"
  | "Lexicon";

interface HexBlob {
  hex: string;
}

interface RegistryMemRecord {
  unknown_0x00: number;
  unknown_0x04: number;
  unknown_0x08: number;
  unknown_0x0a: number;
  unknown_0x0c: number;
  unknown_0x10: HexBlob;
  unknown_0x18: HexBlob;
}

interface RegistryLstRecord {
  unknown_0x00: number;
  unknown_0x04: number;
}

interface RtxSpan {
  member_number: number;
  active: number;
  span_offset: number;
  span_length: number;
}

interface RtxMemberEntry {
  member_number: number;
  span_offset: number;
  span_length: number;
  trailer_active: number;
  payload_sha256: string;
}

interface KindEntry {
  kind: RegistryKind;
  mem: {
    path: string;
    byte_length: number;
    bytes_b64: string;
    record_count: number;
    records: RegistryMemRecord[];
  };
  ptr: {
    path: string;
    byte_length: number;
    bytes_b64: string;
    record_count: number;
    member_numbers: number[];
  };
  lst: {
    path: string;
    byte_length: number;
    bytes_b64: string;
    record_count: number;
    records: RegistryLstRecord[];
  };
  rtx: {
    path: string;
    byte_length: number;
    redacted_bytes_b64: string;
    redacted_sha256: string;
    live_member_count: number;
    members: RtxMemberEntry[];
  };
}

interface Fixture {
  schema: number;
  collection: string;
  scope: string[];
  member_stride: number;
  ptr_stride: number;
  lst_stride: number;
  trailer_struct: string;
  span_struct: string;
  span_offset_in_member: number;
  trailer_size: number;
  kinds: KindEntry[];
}

interface PortModule {
  parseRegistryMem: (bytes: Uint8Array) => RegistryMemRecord[];
  parseRegistryPtr: (bytes: Uint8Array) => number[];
  parseRegistryRtx: (bytes: Uint8Array) => RtxSpan[];
  resolveRegistry: (opts: {
    mem: Uint8Array;
    ptr?: Uint8Array;
    rtx: Uint8Array;
    kind: RegistryKind;
  }) => Map<number, Uint8Array>;
}

async function loadPort(): Promise<PortModule | null> {
  try {
    const mod = await import(MODULE_SPEC);
    if (
      typeof mod?.parseRegistryMem !== "function" ||
      typeof mod?.parseRegistryPtr !== "function" ||
      typeof mod?.parseRegistryRtx !== "function" ||
      typeof mod?.resolveRegistry !== "function"
    ) {
      return null;
    }
    return mod as PortModule;
  } catch {
    return null;
  }
}

function decodeBase64(encoded: string): Uint8Array {
  return new Uint8Array(Buffer.from(encoded, "base64"));
}

const fixture: Fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));

test("fixture declares the registry scope and well-formed kinds", () => {
  assert.equal(fixture.schema, 1);
  assert.deepEqual(fixture.scope, ["registry"]);
  assert.equal(fixture.member_stride, 30);
  assert.equal(fixture.ptr_stride, 4);
  assert.equal(fixture.trailer_size, 5);
  assert.equal(fixture.span_offset_in_member, 0x0a);
  const kinds = fixture.kinds.map((k) => k.kind);
  assert.deepEqual(kinds, [
    "text",
    "image",
    "template",
    "concept",
    "tasklist",
    "Lexicon",
  ]);
  for (const kind of fixture.kinds) {
    assert.equal(kind.mem.byte_length % 30, 0, `${kind.kind}.mem % 30`);
    assert.equal(kind.ptr.byte_length % 4, 0, `${kind.kind}.ptr % 4`);
    assert.equal(kind.lst.byte_length % 8, 0, `${kind.kind}.lst % 8`);
  }
});

test("src/sm18-format-read.ts exports the four registry functions", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("registry exports not implemented yet");
    return;
  }
  assert.equal(typeof port.parseRegistryMem, "function");
  assert.equal(typeof port.parseRegistryPtr, "function");
  assert.equal(typeof port.parseRegistryRtx, "function");
  assert.equal(typeof port.resolveRegistry, "function");
});

test("parseRegistryMem throws on a byte length not a multiple of 30", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("parseRegistryMem not implemented yet");
    return;
  }
  assert.throws(() => port.parseRegistryMem(new Uint8Array(29)));
  assert.throws(() => port.parseRegistryMem(new Uint8Array(31)));
});

test("parseRegistryPtr throws on a byte length not a multiple of 4", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("parseRegistryPtr not implemented yet");
    return;
  }
  assert.throws(() => port.parseRegistryPtr(new Uint8Array(3)));
});

test("parseRegistryRtx throws on a trailer with member_number == 0", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("parseRegistryRtx not implemented yet");
    return;
  }
  // Buffer: 0x58 payload byte, 0x00 terminator, u32 LE member=0, u8 active=1.
  const buf = new Uint8Array([0x58, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
  assert.throws(() => port.parseRegistryRtx(buf));
});

test("parseRegistryRtx throws on a trailer with active != 1", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("parseRegistryRtx not implemented yet");
    return;
  }
  // Buffer: payload byte, \0 terminator, u32 LE member=1, u8 active=0.
  const buf = new Uint8Array([0x58, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]);
  assert.throws(() => port.parseRegistryRtx(buf));
});

test("parseRegistryRtx throws on an incomplete trailer at tail", async (t) => {
  const port = await loadPort();
  if (port === null) {
    t.skip("parseRegistryRtx not implemented yet");
    return;
  }
  // Buffer: payload, \0, then only 4 of 5 trailer bytes.
  const buf = new Uint8Array([0x58, 0x00, 0x01, 0x00, 0x00, 0x00]);
  assert.throws(() => port.parseRegistryRtx(buf));
});

for (const kind of fixture.kinds) {
  test(`format-read-registry: ${kind.kind}.mem parses to ${kind.mem.record_count} records`, async (t) => {
    const port = await loadPort();
    if (port === null) {
      t.skip("parseRegistryMem not implemented yet");
      return;
    }
    const bytes = decodeBase64(kind.mem.bytes_b64);
    assert.equal(bytes.byteLength, kind.mem.byte_length);
    const parsed = port.parseRegistryMem(bytes);
    assert.equal(parsed.length, kind.mem.record_count);
    for (let i = 0; i < kind.mem.record_count; i += 1) {
      assert.deepEqual(
        parsed[i],
        kind.mem.records[i],
        `${kind.kind}.mem record ${i}`,
      );
    }
  });

  test(`format-read-registry: ${kind.kind}.ptr parses to ${kind.ptr.record_count} member numbers`, async (t) => {
    const port = await loadPort();
    if (port === null) {
      t.skip("parseRegistryPtr not implemented yet");
      return;
    }
    const bytes = decodeBase64(kind.ptr.bytes_b64);
    assert.equal(bytes.byteLength, kind.ptr.byte_length);
    const parsed = port.parseRegistryPtr(bytes);
    assert.deepEqual(parsed, kind.ptr.member_numbers);
  });

  test(`format-read-registry: ${kind.kind}.rtx (redacted) walks to ${kind.rtx.live_member_count} spans`, async (t) => {
    const port = await loadPort();
    if (port === null) {
      t.skip("parseRegistryRtx not implemented yet");
      return;
    }
    const bytes = decodeBase64(kind.rtx.redacted_bytes_b64);
    assert.equal(bytes.byteLength, kind.rtx.byte_length);
    const spans = port.parseRegistryRtx(bytes);
    assert.equal(spans.length, kind.rtx.live_member_count);
    // The walker's records come in stored order. The fixture's `members`
    // list is sorted by member_number, so compare by matched key.
    const by_member = new Map(spans.map((s) => [s.member_number, s]));
    for (const want of kind.rtx.members) {
      const got = by_member.get(want.member_number);
      assert.ok(got, `${kind.kind} missing span for member ${want.member_number}`);
      assert.equal(got.span_offset, want.span_offset);
      assert.equal(got.span_length, want.span_length);
      assert.equal(got.active, want.trailer_active);
    }
  });

  test(`format-read-registry: resolveRegistry(${kind.kind}) composes ${kind.rtx.live_member_count} spans`, async (t) => {
    const port = await loadPort();
    if (port === null) {
      t.skip("resolveRegistry not implemented yet");
      return;
    }
    const mem = decodeBase64(kind.mem.bytes_b64);
    const ptr = decodeBase64(kind.ptr.bytes_b64);
    const rtx = decodeBase64(kind.rtx.redacted_bytes_b64);
    const resolved = port.resolveRegistry({
      mem,
      ptr: kind.kind === "text" ? undefined : ptr,
      rtx,
      kind: kind.kind,
    });
    assert.ok(resolved instanceof Map, "resolveRegistry must return a Map");
    assert.equal(resolved.size, kind.rtx.live_member_count);
    for (const want of kind.rtx.members) {
      const got = resolved.get(want.member_number);
      assert.ok(got, `${kind.kind} missing payload for member ${want.member_number}`);
      assert.equal(
        got.byteLength,
        want.span_length,
        `${kind.kind} payload length for member ${want.member_number}`,
      );
    }
  });
}
