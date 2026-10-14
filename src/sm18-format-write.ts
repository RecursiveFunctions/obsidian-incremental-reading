/**
 * SM-18 write-side encoders: `info/ElementInfo.dat` and `info/compon.dat`.
 *
 * Ported from `sm18-re:smfmt/element_info.py` (`FIELDS`, `write_record`,
 * `write_element_info`) and `sm18-re:smfmt/compon.py` (`write`). The
 * conformance fixture is `test/fixtures/sm18-port-format-write.json`, a
 * byte-for-byte mirror of `sm18-re:tests/fixtures/port-format-write.json`
 * generated from the sample collection "ABC of SuperMemo 18"; the contract
 * test is `test/sm18-port-format-write.test.ts`.
 *
 * This is v1 of the `format_write` surface (sm18-re gitlab #38) and the
 * inverse of `src/sm18-format-read.ts`. The other in-scope write-side groups
 * (`info/contents.dat`, the `.mem`/`.ptr`/`.rtx` registry chain,
 * `info/RepetitionHistory.dat`, `info/*.sub` + `subsets/*.sub`,
 * `collection.kno`, the alg17 grids) each land under their own follow-up
 * lane; this module grows additively as they do, one exported encoder per
 * format.
 *
 * ## What these encoders do and do not reconstruct
 *
 * `writeElementInfo` is a total inverse of `parseElementInfo`: an ElementInfo
 * record is fixed-width and every byte of it is a named member, so repacking
 * the parsed projection reproduces the stored bytes. The one exception is the
 * duplicated `legacy` member — see `ELEMENT_INFO_FIELDS` below.
 *
 * `writeCompon` is *not* the inverse of `parseCompon`. The read side
 * deliberately drops every component buffer and the 43-byte element parameter
 * block, so a decoded compon record cannot be re-encoded. The reference
 * writer has the same shape: `smfmt.compon.write` ignores every decoded field
 * and concatenates each record's `_raw` bytes. This port honours that same
 * declared contract — "rebuild the file byte for byte from the records parse
 * returned" — which means `writeCompon` moves bytes it never interprets and
 * reconstructs no user content. A typed-record compon encoder is a separate
 * follow-up lane.
 *
 * Nothing here decodes a Real48. The four 6-byte members travel as `{hex}`
 * blobs in both directions precisely so that a rewrite is bytes-in /
 * bytes-out; routing them through a JS number would lose mantissa bits that
 * the 39-bit Real48 significand carries and `Number` does not.
 */

import type { ElementInfoRecord, HexBlob } from "./sm18-format-read";
import { ELEMENT_INFO_RECORD_SIZE } from "./sm18-format-read";

export type { ElementInfoRecord, HexBlob };
export { ELEMENT_INFO_RECORD_SIZE };

/**
 * One `info/compon.dat` record as the writer takes it: the exact stored bytes
 * and nothing else.
 *
 * This mirrors the `_raw` key that `smfmt.compon.parse` attaches to every
 * record and that `smfmt.compon.write` is the only consumer of. The field is
 * base64 rather than a `Uint8Array` so a record survives the JSON round trip
 * through the fixture unchanged.
 */
export interface ComponRawRecord {
  raw_b64: string;
}

/** Both formats are headerless in the collections this port is pinned on. */
export const ELEMENT_INFO_HEADER_SIZE = 0;

/** @see ELEMENT_INFO_HEADER_SIZE */
export const COMPON_HEADER_SIZE = 0;

/**
 * How one ElementInfo member is stored. These are the Python `struct` codes
 * from `smfmt.element_info.FIELDS`, one-for-one: `B`/`H`/`I` unsigned,
 * `h`/`i` signed, `d` an IEEE-754 double, `6s` an opaque six-byte blob.
 */
type FieldKind = "B" | "H" | "h" | "I" | "i" | "d" | "6s";

const FIELD_WIDTHS: Readonly<Record<FieldKind, number>> = {
  B: 1,
  H: 2,
  h: 2,
  I: 4,
  i: 4,
  d: 8,
  "6s": 6,
};

/**
 * The record layout, transliterated from `smfmt.element_info.FIELDS` in order.
 *
 * The reference packs with `struct.Struct("<" + ...)`. The `<` prefix means
 * little-endian **and** standard sizes with no alignment padding, so a member
 * sits at the running sum of the widths before it and this table alone fixes
 * every offset. `ELEMENT_INFO_RECORD_SIZE` (118) is asserted against that sum
 * at module load, so a mistyped width here fails loudly rather than shifting
 * the tail of every record by a byte.
 *
 * `legacy` appears **twice**, at offset 85 and at offset 89, exactly as it
 * does in `FIELDS`. The reference's `parse_record` builds its dict with
 * `dict(zip(names, values))`, which is last-wins, so the single `legacy` key
 * it returns is the u32 at 89 and the member at 85 is dropped; `write_record`
 * then reads that one key back for both slots and emits it twice. This port
 * reproduces both halves of that behaviour, which is what makes the round
 * trip hold. It holds only while the two stored slots agree — they do in all
 * 76 records of the sample collection, where both are 0, so the fixture does
 * not discriminate between them. A collection where they diverge would
 * round-trip wrong here *and* in the reference; see
 * `sm18-re:docs/findings/port-format-write.md`.
 */
export const ELEMENT_INFO_FIELDS: ReadonlyArray<
  readonly [keyof ElementInfoRecord, FieldKind]
> = [
  ["element_type", "B"],
  ["element_status", "B"],
  ["text_registry_member", "i"],
  ["compon_offset", "i"],
  ["compon_body_length", "H"],
  ["repetition_count", "H"],
  ["lapse_count", "H"],
  ["interval_days", "H"],
  ["last_repetition_day", "h"],
  ["last_repetition_date", "d"],
  ["a_factor", "6s"],
  ["u_factor", "6s"],
  ["last_repetition_row", "I"],
  ["reference_registry_member", "I"],
  ["forgetting_index", "B"],
  ["total_postpone_count", "I"],
  ["recent_postpone_count", "I"],
  ["comment_registry_member", "I"],
  ["template_registry_member", "I"],
  ["concept_group_member", "I"],
  ["concept_definition_member", "I"],
  ["reserved", "I"],
  ["extraction_date", "d"],
  ["legacy", "I"],
  ["legacy", "I"],
  ["source_article", "I"],
  ["difficulty", "6s"],
  ["ordinal", "6s"],
  ["first_grade", "B"],
  ["legacy_element_number", "I"],
  ["first_repetition_day", "I"],
];

const PACKED_RECORD_SIZE = ELEMENT_INFO_FIELDS.reduce(
  (total, [, kind]) => total + FIELD_WIDTHS[kind],
  0,
);

if (PACKED_RECORD_SIZE !== ELEMENT_INFO_RECORD_SIZE) {
  throw new Error(
    `ElementInfo field table packs to ${PACKED_RECORD_SIZE} bytes, ` +
      `expected ${ELEMENT_INFO_RECORD_SIZE}`,
  );
}

/** Inclusive range each integer code accepts, matching Python `struct`. */
const INTEGER_BOUNDS: Readonly<Record<string, readonly [number, number]>> = {
  B: [0, 0xff],
  H: [0, 0xffff],
  h: [-0x8000, 0x7fff],
  I: [0, 0xffffffff],
  i: [-0x80000000, 0x7fffffff],
};

/**
 * Reject a value `struct.pack` would reject.
 *
 * `DataView` setters wrap silently on overflow and truncate a fractional
 * value, so without this a caller's out-of-range `repetition_count` would
 * produce a plausible-looking collection file carrying the wrong number.
 * The reference raises `struct.error`; this raises too, naming the member.
 */
function checkInteger(
  name: string,
  kind: FieldKind,
  value: unknown,
  index: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(
      `ElementInfo.dat: record ${index} field ${name} must be an integer`,
    );
  }
  const bounds = INTEGER_BOUNDS[kind];
  if (value < bounds[0] || value > bounds[1]) {
    throw new Error(
      `ElementInfo.dat: record ${index} field ${name} (${value}) is outside ` +
        `the range of '${kind}' [${bounds[0]}, ${bounds[1]}]`,
    );
  }
  return value;
}

/**
 * Decode one `{hex}` Real48 blob into its six stored bytes.
 *
 * No float decode happens on the write path: these bytes are copied straight
 * back out. `smfmt.element_info.real48` is a read-only view and is not the
 * inverse of anything here.
 */
function hexToReal48(
  name: string,
  value: unknown,
  index: number,
): Uint8Array {
  const hex = (value as HexBlob | undefined)?.hex;
  if (typeof hex !== "string") {
    throw new Error(
      `ElementInfo.dat: record ${index} field ${name} must be a {hex} blob`,
    );
  }
  if (hex.length !== 12 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error(
      `ElementInfo.dat: record ${index} field ${name} must be 12 hex digits, ` +
        `got ${JSON.stringify(hex)}`,
    );
  }
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Encode one 118-byte ElementInfo record into `view` at `base`.
 *
 * Walks `ELEMENT_INFO_FIELDS` in order and advances by each member's width,
 * which is the same traversal `struct.Struct.pack` makes over the format
 * string. Every multi-byte member is little-endian.
 */
function writeElementInfoRecord(
  view: DataView,
  base: number,
  record: ElementInfoRecord,
  index: number,
): void {
  let offset = base;
  for (const [name, kind] of ELEMENT_INFO_FIELDS) {
    const value = record[name];
    switch (kind) {
      case "B":
        view.setUint8(offset, checkInteger(name, kind, value, index));
        break;
      case "H":
        view.setUint16(offset, checkInteger(name, kind, value, index), true);
        break;
      case "h":
        view.setInt16(offset, checkInteger(name, kind, value, index), true);
        break;
      case "I":
        view.setUint32(offset, checkInteger(name, kind, value, index), true);
        break;
      case "i":
        view.setInt32(offset, checkInteger(name, kind, value, index), true);
        break;
      case "d": {
        // Delphi `TDateTime`: the stored double, uninterpreted. NaN is left
        // to the caller; `struct` packs it too, and a collection could in
        // principle hold one.
        if (typeof value !== "number") {
          throw new Error(
            `ElementInfo.dat: record ${index} field ${name} must be a number`,
          );
        }
        view.setFloat64(offset, value, true);
        break;
      }
      case "6s": {
        const blob = hexToReal48(name, value, index);
        for (let i = 0; i < blob.length; i += 1) {
          view.setUint8(offset + i, blob[i]);
        }
        break;
      }
    }
    offset += FIELD_WIDTHS[kind];
  }
}

/**
 * Encode a whole `info/ElementInfo.dat`.
 *
 * Inverse of `parseElementInfo`. The file is headerless, so `header` must be
 * empty; the parameter stays in the signature because the reference's
 * `write_element_info` takes one and because a collection variant with a
 * header would be a change to this module, not to its callers. A non-empty
 * header throws rather than being prepended, matching the reference's
 * `ValueError`.
 */
export function writeElementInfo(
  header: Uint8Array,
  records: ElementInfoRecord[],
): Uint8Array {
  if (header.byteLength !== ELEMENT_INFO_HEADER_SIZE) {
    throw new Error(
      `ElementInfo.dat header must be ${ELEMENT_INFO_HEADER_SIZE} bytes`,
    );
  }
  const out = new Uint8Array(
    header.byteLength + records.length * ELEMENT_INFO_RECORD_SIZE,
  );
  out.set(header, 0);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  for (let i = 0; i < records.length; i += 1) {
    writeElementInfoRecord(
      view,
      header.byteLength + i * ELEMENT_INFO_RECORD_SIZE,
      records[i],
      i,
    );
  }
  return out;
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Reverse lookup for `BASE64_ALPHABET`; -1 for every other code unit. */
const BASE64_VALUES = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decode standard base64 to bytes.
 *
 * Hand-rolled rather than `Buffer.from` or `atob`: this module is bundled
 * into an Obsidian plugin where `Buffer` is absent, and `atob` would mean a
 * round trip through a binary string. It is also strict where both of those
 * are lax — `atob` accepts stray characters and bad padding — and a silently
 * mis-decoded record here would be written straight into a user's collection.
 */
function decodeBase64(encoded: string, label: string): Uint8Array {
  let end = encoded.length;
  while (end > 0 && encoded.charCodeAt(end - 1) === 0x3d /* '=' */) {
    end -= 1;
  }
  if (encoded.length - end > 2 || encoded.length % 4 !== 0) {
    throw new Error(`${label}: malformed base64 padding`);
  }
  if (end % 4 === 1) {
    throw new Error(`${label}: base64 length ${end} is not a whole byte count`);
  }
  const out = new Uint8Array((end * 3) >> 2);
  let accumulator = 0;
  let bits = 0;
  let written = 0;
  for (let i = 0; i < end; i += 1) {
    const code = encoded.charCodeAt(i);
    const value = code < 128 ? BASE64_VALUES[code] : -1;
    if (value < 0) {
      throw new Error(
        `${label}: invalid base64 character at index ${i}`,
      );
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written] = (accumulator >> bits) & 0xff;
      written += 1;
    }
  }
  return out;
}

/**
 * Encode a whole `info/compon.dat`.
 *
 * Concatenates each record's stored bytes in order, which is the reference
 * `smfmt.compon.write` verbatim: it too ignores every decoded field and joins
 * the `_raw` buffers. That is the whole v1 contract. compon is
 * variable-length and 13 of the 40,424 records across the sample collections
 * are damaged — their components stop short of the next marker — so an
 * encoder that rebuilt a record from its decoded fields would not reproduce
 * those records' bytes at all. Round-tripping `_raw` is what keeps a damaged
 * record intact instead of silently normalising it away.
 *
 * As with ElementInfo the file is headerless and a non-empty `header` throws.
 */
export function writeCompon(
  header: Uint8Array,
  records: ComponRawRecord[],
): Uint8Array {
  if (header.byteLength !== COMPON_HEADER_SIZE) {
    throw new Error(`compon.dat header must be ${COMPON_HEADER_SIZE} bytes`);
  }
  const parts: Uint8Array[] = [];
  let total = header.byteLength;
  for (let i = 0; i < records.length; i += 1) {
    const raw = records[i] && records[i].raw_b64;
    if (typeof raw !== "string") {
      throw new Error(`compon.dat: record ${i} lacks raw_b64 bytes`);
    }
    const bytes = decodeBase64(raw, `compon.dat: record ${i}`);
    parts.push(bytes);
    total += bytes.byteLength;
  }
  const out = new Uint8Array(total);
  out.set(header, 0);
  let offset = header.byteLength;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}
