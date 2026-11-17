/**
 * SM-18 priority queue: the element orderings SuperMemo 18 stores on disk.
 *
 * Ported from `sm18-re:smfmt/sub.py` (the `.sub` container),
 * `sm18-re:smfmt/info_subs.py` (`queue_positions`, and the `KINDS["priority"]`
 * account of what `info/priority.sub` is) and
 * `sm18-re:smfmt/element_info.py` (the `info/ElementInfo.dat` record, its two
 * 1-byte enums and its `Real48` members). The conformance fixture is
 * `test/fixtures/sm18-port-priority-queue.json`, a byte-exact mirror of
 * `sm18-re:tests/fixtures/port-priority-queue.json` generated from the sample
 * collection "ABC of SuperMemo 18"; the contract test is
 * `test/sm18-port-priority-queue.test.ts`.
 *
 * ## Scope: this decodes the order, it does not decide it
 *
 * These functions read back the order SuperMemo already committed to disk.
 * They do not recompute it. SM-18's own queue generator, `FUN_00892a98`, sorts
 * by a per-element key it stages in `\temp\priority.ord`:
 *
 *     p     = EI[0x10] or 10000
 *     key   = 15*EI[0x0c] + EI[0x35] + 100000*(1 - shape)
 *     key  += p        if EI[0x00] == 1 else -2*p
 *     key  -= 200000   if EI[0x01] != 1
 *     key  -= 3200     if EI[0x00] != 1
 *
 * Reproducing that key is deliberately out of scope for v1, and not because it
 * is hard: `sm18-re:docs/findings/info_subs.md` shows the key only reproduces
 * the stored order on the two collections whose queue was generated once and
 * barely touched since (concordance 1.0000 on "Net+" and "ABC of SuperMemo 18",
 * against 0.59-0.65 on the three long-used ones). SuperMemo maintains the queue
 * incrementally after generation, so on a working collection the file is the
 * authority and the formula is a drifted historical artifact — a port that
 * recomputed it would disagree with SuperMemo about four collections in six.
 * One term (`shape`, via `FUN_00951324`) has never been evaluated either, so
 * the formula is not fully known in the first place.
 *
 * ## The container
 *
 * Every `.sub` file — `info/priority.sub`, `info/history.sub` and the
 * user-saved `subsets/*.sub` alike — has the same shape: a headerless array of
 * little-endian `uint32` element numbers, no trailer, no inter-record padding.
 * That is why one `parseSub` serves all of them. Element numbers are 1-based:
 * `FUN_00892a98` walks the collection from `local_10 = 1` up to the count
 * `FUN_0094f2fc` returns, and in all six observed collections the largest id in
 * any `info/*.sub` is exactly the `ElementInfo.dat` record count.
 *
 * ## Which end is the front
 *
 * **Position 0 is the highest priority**, the last position the lowest. The
 * generator orders by *descending* key, and the `-200000` term for
 * `EI[0x01] != 1` (an element that is not Memorized) parks those elements at
 * mean position fraction 0.86-0.93 across the used collections — the tail.
 * Decile mean key falls monotonically from head to tail in every collection.
 *
 * No percentage is derived from a position here, matching the Python reference:
 * the divisor SuperMemo displays a priority against is not established.
 *
 * ## DIVERGENCES from the Python reference
 *
 * Interface shape, not behaviour; each one is forced by the language rather
 * than chosen. `sm18-re:docs/findings/port-priority-queue.md` argues each.
 *
 * 1. **`Map`, not a plain object, for `queuePositions`.** Python returns
 *    `dict[int, int]`. A JavaScript object would stringify every element number
 *    into its key, so `positions[7]` and `positions["7"]` would collide and the
 *    key type would quietly stop being a number. `Map` keeps integer keys
 *    integers.
 * 2. **`Uint8Array`, not `bytes`.** The same array of octets; `DataView` reads
 *    the little-endian `uint32`s, so the result does not depend on the host's
 *    byte order. JSON cannot carry bytes, so fixtures carry hex and `decodeHex`
 *    is exported to get from one to the other.
 * 3. **`Real48` lands in a float64.** Delphi's `Real48` has a 39-bit mantissa
 *    and an 8-bit exponent; both fit a float64's 53-bit significand and 11-bit
 *    exponent exactly, so `real48` is lossless rather than approximate. It
 *    cannot use JavaScript's bitwise operators: the mantissa spans 40 bits
 *    across five bytes and `<<` would truncate the operand to 32 bits.
 * 4. **Throws where Python raises.** `struct.iter_unpack` refuses a buffer that
 *    is not a whole number of records, and `queue_positions` raises on a
 *    repeated id. Both throw here, with the same meaning: a `.sub` that does
 *    not decode cleanly is a corrupt file, not an empty queue.
 */

/** Bytes per `.sub` entry: one little-endian `uint32`. */
export const SUB_RECORD_SIZE = 4;

/**
 * `element_type`, from `ELEMENT_TYPES` in `smfmt/element_info.py`. Read off the
 * five-way jump table at `0x9a6419` behind the serializer's `Type=` line, not
 * off the string layout — table entry 3 points past entry 4, so the two
 * disagree about the pairing.
 */
export const ELEMENT_TYPES: { [code: number]: string } = {
  0: "Topic",
  1: "Item",
  2: "Task",
  3: "Template",
  4: "Concept",
};

/** `element_status`, from the companion routine `FUN_009a6810`. */
export const ELEMENT_STATUSES: { [code: number]: string } = {
  0: "Pending",
  1: "Memorized",
  2: "Dismissed",
  3: "Deleted",
};

/**
 * The one `element_status` value that means the element is gone.
 *
 * `info/priority.sub`'s id set is *exactly* the set of elements whose status is
 * not this, in all six observed collections — which is what makes the queue a
 * total order over the live collection rather than a sample of it. Note that
 * `history.sub` does not share the invariant; it keeps ids of deleted elements.
 */
export const ELEMENT_STATUS_DELETED = 3;

/**
 * The slice of an `info/ElementInfo.dat` record this module reads.
 *
 * `element_number` is the record's 1-based index in the file — it is not stored
 * inside the record, so it has to be carried alongside. `ordinal_hex` is the
 * raw six-byte `Real48` rather than a number, so the bytes cross the port
 * boundary undecoded and `real48` can be checked against Python's own decoder.
 */
export interface ElementRecord {
  element_number: number;
  element_type: number;
  element_status: number;
  ordinal_hex: string;
}

/**
 * Decode a hex payload into its bytes, strictly.
 *
 * Here because JSON has no byte type: the fixture carries `.sub` payloads and
 * `Real48` members as hex. ASCII whitespace is skipped, matching Python's
 * `bytes.fromhex`, so a long payload may be wrapped. Anything else — an odd
 * digit count, a non-hex character — throws rather than yielding a buffer that
 * is silently short or full of `NaN`-turned-zero bytes.
 */
export function decodeHex(hex: string): Uint8Array {
  const compact = hex.replace(/\s+/g, "");
  if (compact.length % 2 !== 0) {
    throw new Error(
      `hex payload has an odd digit count (${compact.length}); it cannot be whole bytes`,
    );
  }
  if (compact.length > 0 && !/^[0-9a-fA-F]+$/.test(compact)) {
    throw new Error("hex payload holds a character that is not a hex digit");
  }
  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(compact.substr(index * 2, 2), 16);
  }
  return bytes;
}

/**
 * Decode a `.sub` payload into its element ids, in stored order.
 *
 * Serves `info/priority.sub`, `info/history.sub` and `subsets/*.sub` — one
 * container, one decoder. For `priority.sub` the returned list *is* the
 * priority queue, index 0 being the highest priority.
 *
 * Throws when the payload is not a whole number of 4-byte ids, the way
 * `struct.iter_unpack` does: a partial trailing id means a truncated file.
 */
export function parseSub(data: Uint8Array): number[] {
  if (data.length % SUB_RECORD_SIZE !== 0) {
    throw new Error(
      `.sub payload of ${data.length} bytes ends with a partial element id ` +
        `(not a multiple of ${SUB_RECORD_SIZE})`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ids: number[] = [];
  for (let offset = 0; offset < data.length; offset += SUB_RECORD_SIZE) {
    ids.push(view.getUint32(offset, true));
  }
  return ids;
}

/**
 * Map each element id in a `.sub` payload to its 0-based stored position.
 *
 * For `priority.sub` that position is the element's place in the priority
 * queue, 0 being the highest priority. For `history.sub` it is how far back the
 * element was last visited.
 *
 * Throws when the payload repeats an id, which none of the observed copies do:
 * a list with a repeat is a multiset, and a multiset is not an ordering.
 */
export function queuePositions(data: Uint8Array): Map<number, number> {
  const ids = parseSub(data);
  const positions = new Map<number, number>();
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    const seen = positions.get(id);
    if (seen !== undefined) {
      throw new Error(
        `.sub repeats element id ${id} (positions ${seen} and ${index}); ` +
          "it is not an ordering",
      );
    }
    positions.set(id, index);
  }
  return positions;
}

/** Ascending numeric order; `Array.prototype.sort` is lexicographic by default. */
function ascending(numbers: number[]): number[] {
  return numbers.slice().sort((left, right) => left - right);
}

/**
 * The element numbers of every element that still exists, in ascending order.
 *
 * This is the set `info/priority.sub` is a permutation of, so it is the natural
 * cross-check on a decoded queue: if the two sets differ, either the queue file
 * or `ElementInfo.dat` is stale.
 */
export function liveElementNumbers(records: ElementRecord[]): number[] {
  return ascending(
    records
      .filter((record) => record.element_status !== ELEMENT_STATUS_DELETED)
      .map((record) => record.element_number),
  );
}

/**
 * The complement of `liveElementNumbers`: element numbers marked Deleted.
 *
 * These records stay in the file. `ElementInfo.dat` is indexed by element
 * number, so a deleted element's slot cannot be reclaimed without renumbering
 * every element after it. Expect these ids to be absent from `priority.sub` and
 * still present in `history.sub`.
 */
export function deletedElementNumbers(records: ElementRecord[]): number[] {
  return ascending(
    records
      .filter((record) => record.element_status === ELEMENT_STATUS_DELETED)
      .map((record) => record.element_number),
  );
}

/** `Real48` exponents are biased by 129 (`FUN_0040a370`: 0x3fff - 0x3f7e). */
const REAL48_BIAS = 129;
const REAL48_MANTISSA_BITS = 39;
const REAL48_MANTISSA_SCALE = Math.pow(2, REAL48_MANTISSA_BITS);
const REAL48_SIZE = 6;

/**
 * Decode one Delphi `Real48` — six bytes: an exponent byte, then a 39-bit
 * mantissa and a sign bit packed little-endian into the remaining five.
 *
 * A zero exponent is the encoder's underflow case, not a denormal:
 * `FUN_0040a370` writes all six bytes as zero there, so it reads back as 0.0.
 *
 * Assembled with arithmetic rather than `<<`/`|` on purpose — the packed tail
 * occupies 40 bits and JavaScript's bitwise operators truncate to 32.
 */
export function real48(raw: Uint8Array): number {
  if (raw.length !== REAL48_SIZE) {
    throw new Error(`a Real48 is exactly six bytes, got ${raw.length}`);
  }
  const exponent = raw[0];
  if (exponent === 0) {
    return 0.0;
  }
  // Bits 0..31 of the packed tail, then its top byte: bit 39 is the sign and
  // bits 32..38 are the mantissa's high end.
  const low = raw[1] + raw[2] * 0x100 + raw[3] * 0x10000 + raw[4] * 0x1000000;
  const top = raw[5];
  const sign = (top & 0x80) !== 0 ? -1.0 : 1.0;
  const fraction = (low + (top & 0x7f) * 0x100000000) / REAL48_MANTISSA_SCALE;
  return sign * (1.0 + fraction) * Math.pow(2, exponent - REAL48_BIAS);
}

/**
 * An element's `ordinal` as a number.
 *
 * `ordinal` is SuperMemo's within-parent sort position — the value behind the
 * serializer's `Ordinal=` line — and it is a `Real48` rather than an integer
 * precisely so an element can be slotted between two neighbours without
 * renumbering them.
 */
export function elementOrdinal(record: ElementRecord): number {
  return real48(decodeHex(record.ordinal_hex));
}

/** Name an `element_type` code, or report it as unknown rather than guessing. */
export function elementTypeName(code: number): string {
  return ELEMENT_TYPES[code] ?? `Unknown(${code})`;
}

/** Name an `element_status` code, or report it as unknown rather than guessing. */
export function elementStatusName(code: number): string {
  return ELEMENT_STATUSES[code] ?? `Unknown(${code})`;
}
