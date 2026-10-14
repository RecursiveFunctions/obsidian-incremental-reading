/**
 * SM-18 read-side decoders: `info/ElementInfo.dat` and `info/compon.dat`.
 *
 * Ported from `sm18-re:smfmt/element_info.py` and `sm18-re:smfmt/compon.py`.
 * The conformance fixture is `test/fixtures/sm18-port-format-read.json`, a
 * byte-for-byte mirror of `sm18-re:tests/fixtures/port-format-read.json`
 * generated from the sample collection "ABC of SuperMemo 18"; the contract
 * test is `test/sm18-port-format-read.test.ts`.
 *
 * This is v1 of the `format_read` surface (sm18-re gitlab #36). It lets the
 * plugin open a SuperMemo collection's element metadata without shelling out
 * to the campaign repo. The other in-scope read-side groups
 * (`info/contents.dat`, the `.mem`/`.ptr`/`.rtx` registry chain,
 * `info/RepetitionHistory.dat`, `info/*.sub` + `subsets/*.sub`,
 * `collection.kno`) each land under their own follow-up lane; this module
 * grows additively as they do, one exported parser per format.
 *
 * ## What these parsers do and do not decode
 *
 * Both formats are headerless containers of inert numeric metadata. Neither
 * parser reconstructs user content: `parseCompon` deliberately drops every
 * component buffer and the 43-byte element parameter block, which is where a
 * component's text, reference and media payload live. A caller that wants
 * element text goes through the registry chain, not through here.
 *
 * The four 6-byte members of an ElementInfo record (`a_factor`, `u_factor`,
 * `difficulty`, `ordinal`) are Delphi `Real48` values. They are returned as
 * `{hex}` blobs rather than numbers, on purpose: SM-18's own reader keeps them
 * as 6-byte blobs, a `Real48` has a 39-bit mantissa that no JS number type
 * stores natively, and holding the port to bytes-in / bytes-out means a
 * rewrite of a record can reproduce the stored bytes exactly. The decode
 * (`smfmt.element_info.real48`) is a separate concern and is not on this
 * lane's gate.
 */

/** A raw field returned as hex-encoded bytes rather than a decoded number. */
export interface HexBlob {
  hex: string;
}

/**
 * One `info/ElementInfo.dat` record.
 *
 * Field names and semantics come from `sm18-re:docs/findings/element_info.md`;
 * 29 non-date members are listed there as settled (`VERIFIED_FIELDS`) and the
 * two `TDateTime` doubles are argued from writer sites in the executable.
 * `reserved` and the two `legacy` slots carry deliberately conservative names:
 * their offsets and widths are pinned, their purpose is not.
 */
export interface ElementInfoRecord {
  element_type: number;
  element_status: number;
  text_registry_member: number;
  compon_offset: number;
  compon_body_length: number;
  repetition_count: number;
  lapse_count: number;
  interval_days: number;
  last_repetition_day: number;
  /** Delphi `TDateTime`: raw IEEE-754 double, no calendar conversion applied. */
  last_repetition_date: number;
  a_factor: HexBlob;
  u_factor: HexBlob;
  last_repetition_row: number;
  reference_registry_member: number;
  forgetting_index: number;
  total_postpone_count: number;
  recent_postpone_count: number;
  comment_registry_member: number;
  template_registry_member: number;
  concept_group_member: number;
  concept_definition_member: number;
  reserved: number;
  /** Delphi `TDateTime`: raw IEEE-754 double, no calendar conversion applied. */
  extraction_date: number;
  legacy: number;
  legacy_element_number: number;
  source_article: number;
  difficulty: HexBlob;
  ordinal: HexBlob;
  first_grade: number;
  first_repetition_day: number;
}

/** `element_type`, from the enum-to-string jump table behind `Type=`. */
export const ELEMENT_TYPES: Readonly<Record<number, string>> = {
  0: "Topic",
  1: "Item",
  2: "Task",
  3: "Template",
  4: "Concept",
};

/** `element_status`, from the companion routine behind `Status=`. */
export const ELEMENT_STATUSES: Readonly<Record<number, string>> = {
  0: "Pending",
  1: "Memorized",
  2: "Dismissed",
  3: "Deleted",
};

/**
 * Every ElementInfo record is exactly 118 (`0x76`) bytes and the file is
 * headerless. The width is not inferred from record counts: the legacy
 * `elinfo.dat` converter zero-fills `0x76` bytes of one stack record and then
 * writes each member at a fixed displacement from that base.
 */
export const ELEMENT_INFO_RECORD_SIZE = 118;

/** The members that stay 6-byte `Real48` blobs instead of being decoded. */
export const REAL48_FIELDS = [
  "a_factor",
  "u_factor",
  "difficulty",
  "ordinal",
] as const;

/**
 * Offset of each member inside a record, transliterated from the `FIELDS`
 * table in `smfmt/element_info.py`. The Python struct format string is
 * little-endian with the `<` prefix, so it is unpadded and these offsets are
 * just the running sum of the member widths.
 *
 * `FIELDS` names `legacy` twice, at 85 and at 89. `parse_record` builds its
 * dict with `dict(zip(names, values))`, and dict construction is last-wins,
 * so the reference's single `legacy` key holds the u32 at **89** and the
 * member at 85 is dropped from the projection. This port reproduces that
 * exactly. Beware: both offsets are 0 in all 76 records of the sample
 * collection, so the fixture does not discriminate between them — see
 * `sm18-re:docs/findings/port-format-read.md`.
 */
const ELEMENT_INFO_OFFSETS = {
  element_type: 0,
  element_status: 1,
  text_registry_member: 2,
  compon_offset: 6,
  compon_body_length: 10,
  repetition_count: 12,
  lapse_count: 14,
  interval_days: 16,
  last_repetition_day: 18,
  last_repetition_date: 20,
  a_factor: 28,
  u_factor: 34,
  last_repetition_row: 40,
  reference_registry_member: 44,
  forgetting_index: 48,
  total_postpone_count: 49,
  recent_postpone_count: 53,
  comment_registry_member: 57,
  template_registry_member: 61,
  concept_group_member: 65,
  concept_definition_member: 69,
  reserved: 73,
  extraction_date: 77,
  legacy: 89,
  source_article: 93,
  difficulty: 97,
  ordinal: 103,
  first_grade: 109,
  legacy_element_number: 110,
  first_repetition_day: 114,
} as const;

const HEX_DIGITS = "0123456789abcdef";

/** Hex-encode a slice, matching Python's `bytes.hex()` (lowercase, no sep). */
function hexSlice(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const byte = view.getUint8(offset + i);
    out += HEX_DIGITS[byte >> 4] + HEX_DIGITS[byte & 0x0f];
  }
  return out;
}

function real48(view: DataView, offset: number): HexBlob {
  return { hex: hexSlice(view, offset, 6) };
}

/** Decode one 118-byte ElementInfo record from `view` at `base`. */
function parseElementInfoRecord(view: DataView, base: number): ElementInfoRecord {
  const o = ELEMENT_INFO_OFFSETS;
  // Every multi-byte member is little-endian; `text_registry_member`,
  // `compon_offset` (`i`) and `last_repetition_day` (`h`) are the signed ones.
  return {
    element_type: view.getUint8(base + o.element_type),
    element_status: view.getUint8(base + o.element_status),
    text_registry_member: view.getInt32(base + o.text_registry_member, true),
    compon_offset: view.getInt32(base + o.compon_offset, true),
    compon_body_length: view.getUint16(base + o.compon_body_length, true),
    repetition_count: view.getUint16(base + o.repetition_count, true),
    lapse_count: view.getUint16(base + o.lapse_count, true),
    interval_days: view.getUint16(base + o.interval_days, true),
    last_repetition_day: view.getInt16(base + o.last_repetition_day, true),
    last_repetition_date: view.getFloat64(base + o.last_repetition_date, true),
    a_factor: real48(view, base + o.a_factor),
    u_factor: real48(view, base + o.u_factor),
    last_repetition_row: view.getUint32(base + o.last_repetition_row, true),
    reference_registry_member: view.getUint32(base + o.reference_registry_member, true),
    forgetting_index: view.getUint8(base + o.forgetting_index),
    total_postpone_count: view.getUint32(base + o.total_postpone_count, true),
    recent_postpone_count: view.getUint32(base + o.recent_postpone_count, true),
    comment_registry_member: view.getUint32(base + o.comment_registry_member, true),
    template_registry_member: view.getUint32(base + o.template_registry_member, true),
    concept_group_member: view.getUint32(base + o.concept_group_member, true),
    concept_definition_member: view.getUint32(base + o.concept_definition_member, true),
    reserved: view.getUint32(base + o.reserved, true),
    extraction_date: view.getFloat64(base + o.extraction_date, true),
    legacy: view.getUint32(base + o.legacy, true),
    legacy_element_number: view.getUint32(base + o.legacy_element_number, true),
    source_article: view.getUint32(base + o.source_article, true),
    difficulty: real48(view, base + o.difficulty),
    ordinal: real48(view, base + o.ordinal),
    first_grade: view.getUint8(base + o.first_grade),
    first_repetition_day: view.getUint32(base + o.first_repetition_day, true),
  };
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Decode a whole `info/ElementInfo.dat`.
 *
 * The file is headerless, so the record count is just its length over 118.
 * A trailing partial record throws rather than being dropped: the reference
 * raises `ValueError` there, and silently ignoring tail bytes would hide a
 * truncated or misidentified file.
 */
export function parseElementInfo(bytes: Uint8Array): ElementInfoRecord[] {
  if (bytes.byteLength % ELEMENT_INFO_RECORD_SIZE !== 0) {
    throw new Error("ElementInfo.dat ends with a partial record");
  }
  const view = viewOf(bytes);
  const count = bytes.byteLength / ELEMENT_INFO_RECORD_SIZE;
  const records: ElementInfoRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    records.push(parseElementInfoRecord(view, i * ELEMENT_INFO_RECORD_SIZE));
  }
  return records;
}

/** One packed `info/RepetitionHistory.dat` record. */
export interface RepetitionHistoryRecord {
  element_id: number;
  repetition_number: number;
  lapse_count: number;
  interval_days: number;
  /** Delphi `TDateTime`: raw IEEE-754 double, no calendar conversion applied. */
  repetition_date: number;
  /** Signed repetition grade/status code. */
  grade: number;
}

/** RepetitionHistory.dat is a headerless sequence of packed 39-byte records. */
export const REPETITION_HISTORY_RECORD_SIZE = 0x27;

/**
 * Decode a whole `info/RepetitionHistory.dat`.
 *
 * This is not a contiguous aligned struct. In particular, the little-endian
 * float64 `repetition_date` starts at the deliberately unaligned offset 0x0a,
 * so every projected field is read at its explicit reference offset. The
 * remaining bytes are outside this read-side projection.
 */
export function parseRepetitionHistory(
  bytes: Uint8Array,
): RepetitionHistoryRecord[] {
  if (bytes.byteLength % REPETITION_HISTORY_RECORD_SIZE !== 0) {
    throw new Error("RepetitionHistory.dat ends with a partial 39-byte record");
  }

  const view = viewOf(bytes);
  const records: RepetitionHistoryRecord[] = [];
  for (
    let base = 0;
    base < bytes.byteLength;
    base += REPETITION_HISTORY_RECORD_SIZE
  ) {
    records.push({
      element_id: view.getUint32(base + 0x00, true),
      repetition_number: view.getUint16(base + 0x04, true),
      lapse_count: view.getUint16(base + 0x06, true),
      interval_days: view.getUint16(base + 0x08, true),
      repetition_date: view.getFloat64(base + 0x0a, true),
      grade: view.getInt8(base + 0x18),
    });
  }
  return records;
}

/** One component of a compon record, with its buffer dropped. */
export interface ComponComponent {
  component_type: number;
  buffer_size: number;
}

/** One `info/compon.dat` record, with buffers and parameter block dropped. */
export interface ComponRecord {
  element_number: number;
  component_count: number;
  element_param_size: number;
  components: ComponComponent[];
}

/** Every compon record opens on this u16. */
export const COMPON_MARKER = 0xd431;

/** The marker and the u16 body length that follows it. */
export const COMPON_RECORD_HEADER_SIZE = 4;

/**
 * Records are contiguous, so a well-formed record's components end exactly on
 * the next record's marker. This stride is only used to resynchronise past a
 * damaged record, whose declared length stops short of that marker.
 */
export const COMPON_RESYNC_STRIDE = 4;

/** The reader rejects a larger element parameter block. */
export const COMPON_ELEMENT_PARAM_SIZE = 0x2b;

/** The component type byte plus its two-byte buffer size. */
export const COMPON_COMPONENT_HEADER_SIZE = 3;

/**
 * Expected component buffer size per type, from the reader's own size table.
 * Types 8, 9 and 15 upwards are rejected as "Unregistered component type".
 *
 * This table is exported for callers that want to validate a stored size, but
 * the parser does not enforce it: the reference does not either, and a port
 * that rejected an off-table size would fail on a file SM-18 itself reads.
 */
export const COMPONENT_BUFFER_SIZES: Readonly<Record<number, number>> = {
  0: 0x22,
  1: 0x22,
  2: 0x19,
  3: 0x30,
  4: 0x1f,
  5: 0x1b,
  6: 0x1b,
  7: 0x1b,
  10: 0x3f,
  11: 0x3f,
  12: 0x1d,
  13: 0x1c,
  14: 0x1d,
};

/** Byte offsets of the element fields, relative to a record's start. */
const COMPON_ELEMENT_NUMBER_OFFSET = 4;
const COMPON_COMPONENT_COUNT_OFFSET = 8;
const COMPON_ELEMENT_PARAM_SIZE_OFFSET = 9;
const COMPON_ELEMENT_PARAMETERS_OFFSET = 11;

function isMarker(view: DataView, offset: number): boolean {
  return (
    offset + 2 <= view.byteLength &&
    view.getUint16(offset, true) === COMPON_MARKER
  );
}

interface ComponSpan {
  /** Where the record's marker is. */
  offset: number;
  /** Bytes the record occupies, which is what tiles the file. */
  spanLength: number;
  /** `4 + stored body length`: where the decodable part stops. */
  bodyLength: number;
}

/**
 * Walk the file into one span per record.
 *
 * A well-formed record's stored length covers its header, element fields and
 * components exactly, so its span is `4 + body_length` and the next marker
 * follows immediately. A damaged record's components stop short of the next
 * marker, so its span absorbs the bytes its length failed to cover and the
 * spans still tile the file: no bytes are lost, and `bodyLength` marks where
 * the decodable part ends inside the span. `spanLength !== bodyLength` is
 * exactly the signal that a record is damaged.
 */
function componSpans(bytes: Uint8Array): ComponSpan[] {
  const view = viewOf(bytes);
  const spans: ComponSpan[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + COMPON_RECORD_HEADER_SIZE > bytes.byteLength) {
      throw new Error(`compon.dat: truncated record header at ${offset}`);
    }
    if (!isMarker(view, offset)) {
      throw new Error(`compon.dat: marker 0xd431 expected at ${offset}`);
    }
    const bodyLength =
      COMPON_RECORD_HEADER_SIZE + view.getUint16(offset + 2, true);
    let end = offset + bodyLength;
    if (end > bytes.byteLength) {
      throw new Error(`compon.dat: record at ${offset} runs past the file`);
    }
    while (end < bytes.byteLength && !isMarker(view, end)) {
      end += COMPON_RESYNC_STRIDE;
      if (end > bytes.byteLength) {
        throw new Error(
          `compon.dat: record at ${offset} never reaches the next marker`,
        );
      }
    }
    spans.push({ offset, spanLength: end - offset, bodyLength });
    offset = end;
  }
  return spans;
}

/**
 * Decode one record's fields from the `length`-byte slice starting at `base`.
 *
 * Throws if the record does not parse, including if its components do not
 * exactly fill it — a record whose components leave bytes over is not a record
 * this format explains, and guessing at the remainder would invent a field.
 */
function decodeComponRecord(
  view: DataView,
  base: number,
  length: number,
): ComponRecord {
  const end = base + length;
  const marker = view.getUint16(base, true);
  if (marker !== COMPON_MARKER) {
    throw new Error(`compon.dat: bad record marker ${marker}`);
  }
  // Checked up front so that no read below can reach past `end` into the next
  // record's bytes and return a plausible-looking field from them.
  if (length < COMPON_ELEMENT_PARAMETERS_OFFSET) {
    throw new Error(
      `compon.dat: record declares ${length} bytes, too short for its element fields`,
    );
  }

  const element_number = view.getUint32(base + COMPON_ELEMENT_NUMBER_OFFSET, true);
  const component_count = view.getUint8(base + COMPON_COMPONENT_COUNT_OFFSET);
  const element_param_size = view.getUint16(
    base + COMPON_ELEMENT_PARAM_SIZE_OFFSET,
    true,
  );

  // The 43-byte parameter block itself is skipped, not returned: it is not
  // understood, and it is where per-element payload would hide.
  let offset = base + COMPON_ELEMENT_PARAMETERS_OFFSET + element_param_size;
  if (offset > end) {
    throw new Error("compon.dat: element parameters run past the record");
  }

  const components: ComponComponent[] = [];
  for (let i = 0; i < component_count; i += 1) {
    if (offset + COMPON_COMPONENT_HEADER_SIZE > end) {
      throw new Error(
        `compon.dat: component header at ${offset - base} runs past the record`,
      );
    }
    const component_type = view.getUint8(offset);
    const buffer_size = view.getUint16(offset + 1, true);
    const bufferEnd = offset + COMPON_COMPONENT_HEADER_SIZE + buffer_size;
    if (bufferEnd > end) {
      throw new Error(
        `compon.dat: component buffer at ${offset - base} runs past the record`,
      );
    }
    components.push({ component_type, buffer_size });
    offset = bufferEnd;
  }

  if (offset !== end) {
    throw new Error(
      `compon.dat: record leaves ${end - offset} bytes undecoded`,
    );
  }

  return { element_number, component_count, element_param_size, components };
}

/**
 * Decode a whole `info/compon.dat`.
 *
 * There is no header: the file opens on the first record's marker. An empty
 * input is an empty file, not an error.
 *
 * A record whose own bytes will not parse is **dropped from the result** here,
 * where the Python reference keeps it as a `{_raw, unknown_undecoded}` stub so
 * that `smfmt.compon.write` can round-trip the file byte for byte. This port
 * is read-only and its record type has no field for undecodable bytes, so such
 * a record cannot be represented; dropping it shifts the record count away
 * from the reference's. That is the one divergence the TS port cannot avoid
 * under this record shape, and it is why `parseCompon` must not be used as the
 * read half of a rewrite. No record in any of the six known copies of the file
 * is in that state, so nothing observable rests on it today. See
 * `sm18-re:docs/findings/port-format-read.md`.
 *
 * A record that parses but whose declared length stops short of the next
 * marker (`unknown_inconsistent_length` in the reference — 13 such records
 * across the six known copies of the file) is kept: its decodable part is
 * returned and the bytes past its declared length are left undecoded, exactly
 * as the reference does.
 */
export function parseCompon(bytes: Uint8Array): ComponRecord[] {
  if (bytes.byteLength === 0) {
    return [];
  }
  const view = viewOf(bytes);
  const records: ComponRecord[] = [];
  for (const span of componSpans(bytes)) {
    let record: ComponRecord;
    try {
      record = decodeComponRecord(view, span.offset, span.bodyLength);
    } catch {
      continue;
    }
    records.push(record);
  }
  return records;
}

/** One 950-byte `.KNO` collection descriptor. */
export interface KnoRecord {
  element_count: number;
  deleted_element_count: number;
  next_element_id: number;
  format_version: number;
  [unknown: string]: number | HexBlob;
}

/** SuperMemo 18's collection descriptor size (`0x3b6`). */
export const KNO_RECORD_SIZE = 950;

/** First byte of the opaque descriptor suffix. */
const KNO_UNKNOWN_START = 0x0d;

/** Width used by the reference's offset-labelled opaque suffix fields. */
const KNO_UNKNOWN_SLICE_SIZE = 8;

/**
 * Decode one `.KNO` collection descriptor.
 *
 * The descriptor is exactly one headerless 950-byte record. Only the leading
 * three counters and format version have defended names; every remaining byte
 * is preserved in the same offset-labelled, at-most-eight-byte `{hex}` slice
 * produced by `smfmt/kno.py`. The final slice is deliberately short.
 */
export function parseKno(bytes: Uint8Array): KnoRecord {
  if (bytes.byteLength !== KNO_RECORD_SIZE) {
    throw new Error(`Kno descriptor must be exactly ${KNO_RECORD_SIZE} bytes`);
  }

  const view = viewOf(bytes);
  const record: KnoRecord = {
    element_count: view.getUint32(0x00, true),
    deleted_element_count: view.getUint32(0x04, true),
    next_element_id: view.getUint32(0x08, true),
    format_version: view.getUint8(0x0c),
  };

  for (
    let offset = KNO_UNKNOWN_START;
    offset < KNO_RECORD_SIZE;
    offset += KNO_UNKNOWN_SLICE_SIZE
  ) {
    const name = `unknown_0x${offset.toString(16).padStart(3, "0")}`;
    const length = Math.min(KNO_UNKNOWN_SLICE_SIZE, KNO_RECORD_SIZE - offset);
    record[name] = { hex: hexSlice(view, offset, length) };
  }

  return record;
}

/** Bytes per `.sub` entry: one little-endian `uint32` element id. */
export const SUB_RECORD_SIZE = 4;

/**
 * Observed ceiling on `history.sub` across the Cyber-family copies.
 * This is an observation from those files, not a constant read from the executable.
 */
export const HISTORY_CAP = 1000;

/** The known `info/*.sub` filename stems, matched case-insensitively. */
const SUB_KINDS: Readonly<Record<string, string>> = {
  history: "history",
  priority: "priority",
  outstanding: "outstanding",
  outstandingitems: "outstandingitems",
  outstandingtopics: "outstandingtopics",
};

/**
 * Decode an `info/*.sub` or `subsets/*.sub` payload in stored order.
 *
 * The container has no header or trailer: every four bytes are one unsigned,
 * little-endian, 1-based element id. Resolving those ids to ElementInfo records
 * belongs to callers rather than this decoder.
 */
export function parseSub(bytes: Uint8Array): number[] {
  if (bytes.byteLength % SUB_RECORD_SIZE !== 0) {
    throw new Error(".sub ends with a partial element id");
  }
  const view = viewOf(bytes);
  const ids: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += SUB_RECORD_SIZE) {
    ids.push(view.getUint32(offset, true));
  }
  return ids;
}

/**
 * Resolve a bare name, stem, or path against the known `info/*.sub` kinds.
 * Unknown names, including arbitrary user-saved subset names, return `null`.
 */
export function subKind(name: string): string | null {
  const normalized = name.replace(/\\/g, "/");
  const leaf = normalized.slice(normalized.lastIndexOf("/") + 1);
  const stem = leaf.toLowerCase().endsWith(".sub") ? leaf.slice(0, -4) : leaf;
  return SUB_KINDS[stem.toLowerCase()] ?? null;
}

/**
 * Map each element id to its zero-based ordinal position in stored order.
 * Duplicate ids are rejected because a repeated member is not an ordering.
 */
export function queuePositions(bytes: Uint8Array): Map<number, number> {
  const positions = new Map<number, number>();
  for (const [position, elementId] of parseSub(bytes).entries()) {
    if (positions.has(elementId)) {
      throw new Error("info/*.sub repeats an element id; it is not an ordering");
    }
    positions.set(elementId, position);
  }
  return positions;
}


/**
 * One `info/contents.dat` record, with `_raw` dropped.
 *
 * Every member is still `unknown_*`. This is not an oversight to tidy up in
 * the port: `sm18-re:smfmt/contents.py` refuses to name them, and
 * `sm18-re:docs/findings/contents.md` says why — the offsets and widths are
 * byte-supported, but the records' roles in the contents *tree* have not been
 * defended. Several of the values look like tree links, and naming them
 * `parent` / `child` / `sibling` here would smuggle a semantic claim the
 * campaign repository has not made into a module that reads like evidence.
 * The fixture cannot catch that: it pins values, not meanings. The names stay
 * offset labels until a campaign lane earns better ones.
 */
export interface ContentsRecord {
  unknown_0x00: number;
  unknown_0x01: number;
  unknown_0x05: number;
  unknown_0x09: number;
  unknown_0x0d: number;
  unknown_0x11: number;
  unknown_0x15: number;
  unknown_0x19: number;
  unknown_0x1d: number;
  unknown_0x21: number;
}

/**
 * Every contents record is exactly 37 (`0x25`) bytes and the file is
 * headerless, so the record count is the file length over 37.
 *
 * The width is not inferred from record counts — it could not be, since a
 * collection's contents record count can exceed its `ElementInfo.dat` count.
 * SuperMemo configures the backing stream with the literal `0x25` at
 * `0x931254`, and its creation path configures the same width, builds a
 * 37-byte record and clears exactly `0x25` bytes before writing it.
 */
export const CONTENTS_RECORD_SIZE = 37;

/**
 * Member offsets, transliterated from the `offsets` tuple in
 * `smfmt/contents.py` and paired with `struct.Struct("<B9I")`: a `u8` at 0,
 * then nine little-endian `u32`.
 *
 * Note that the `u32` members all sit at offsets `≡ 1 (mod 4)`. The Python
 * format string is little-endian with the `<` prefix so it is unpadded, and
 * the leading `u8` pushes every following member off a 4-byte boundary. A
 * port must therefore read them through a `DataView`; laying a `Uint32Array`
 * over the buffer is both misaligned and wrong by one byte per member.
 */
const CONTENTS_OFFSETS = [1, 5, 9, 13, 17, 21, 25, 29, 33] as const;

/** Decode one 37-byte contents record from `view` at `base`. */
function parseContentsRecord(view: DataView, base: number): ContentsRecord {
  const [o01, o05, o09, o0d, o11, o15, o19, o1d, o21] = CONTENTS_OFFSETS;
  return {
    unknown_0x00: view.getUint8(base),
    unknown_0x01: view.getUint32(base + o01, true),
    unknown_0x05: view.getUint32(base + o05, true),
    unknown_0x09: view.getUint32(base + o09, true),
    unknown_0x0d: view.getUint32(base + o0d, true),
    unknown_0x11: view.getUint32(base + o11, true),
    unknown_0x15: view.getUint32(base + o15, true),
    unknown_0x19: view.getUint32(base + o19, true),
    unknown_0x1d: view.getUint32(base + o1d, true),
    unknown_0x21: view.getUint32(base + o21, true),
  };
}

/**
 * Decode a whole `info/contents.dat`.
 *
 * Ported from `sm18-re:smfmt/contents.py`; the contract test is
 * `test/sm18-port-format-read-contents.test.ts` against a byte-identical
 * mirror of `sm18-re:tests/fixtures/port-format-read-contents.json`.
 *
 * A length that is not a multiple of 37 throws, matching the reference's
 * `ValueError`. It is deliberately not treated as a truncation to tolerate:
 * the one thing a variable-length codec is judged on is finding record
 * boundaries, so a file that does not tile into 37-byte records is either
 * truncated or not this format, and either way its leading records are not
 * trustworthy enough to return.
 *
 * `_raw` is dropped from the projection, as in the `parseCompon` contract.
 * That makes this parser read-only: `smfmt.contents.write` rebuilds the file
 * from `_raw`, and a rewrite path needs its own parser that keeps each
 * record's bytes.
 */
export function parseContents(bytes: Uint8Array): ContentsRecord[] {
  if (bytes.byteLength % CONTENTS_RECORD_SIZE !== 0) {
    throw new Error("contents.dat length is not a multiple of 37 bytes");
  }
  const view = viewOf(bytes);
  const count = bytes.byteLength / CONTENTS_RECORD_SIZE;
  const records: ContentsRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    records.push(parseContentsRecord(view, i * CONTENTS_RECORD_SIZE));
  }
  return records;
}
