/**
 * SM-18 incremental-reading mechanics: what a child element inherits from the
 * element it was made from.
 *
 * Ported from `sm18-re:smfmt/element_info.py` (the `info/ElementInfo.dat`
 * record) and `sm18-re:smfmt/compon.py` (the `info/compon.dat` component
 * skeleton). The conformance fixture is
 * `test/fixtures/sm18-port-ir-mechanics.json`, a mirror of
 * `sm18-re:tests/fixtures/port-ir-mechanics.json` generated from the sample
 * collection "ABC of SuperMemo 18"; the contract test is
 * `test/sm18-port-ir-mechanics.test.ts`.
 *
 * Scope: structural invariants only. Given a parent record and the kind of IR
 * action the user took, produce the child's inherited and structural fields.
 * Reconstructing the child's *content* payload (which span was extracted, what
 * got clozed) is a separate design question and is deliberately out of scope —
 * these factories never see the parent's text.
 *
 * ## What is inherited, and why
 *
 * Only one field is inherited on the strength of a proven cross-file relation.
 * The other three are decided, not copied. From
 * `sm18-re:docs/findings/element_info.md`:
 *
 * - `concept_group_member` (`0x41`) — **inherited.** "Inherited by every
 *   extract from its source element - 12,437 of 12,437 pairs." A child stays
 *   in its source's concept group.
 * - `concept_definition_member` (`0x45`) — **not inherited.** "Inherited in
 *   none of the 62 pairs where it could be." The field is a one-to-one back
 *   pointer: `concept.dat` record `m - 1` points back at the single element
 *   that defines concept `m`. A freshly made child defines no concept, so it
 *   is 0 — copying the parent's value would forge a second definer.
 * - `comment_registry_member` (`0x39`) — **not inherited.** "Non-zero in 5 of
 *   32,104 records ... exactly the live member set of `registry/comment.ptr`,
 *   one-to-one." Also a per-element registry slot, assigned when a comment is
 *   attached to that element and never by descent. A new child has no comment,
 *   so it is 0. The field was initially listed in the fixture's
 *   `INHERITED_FIELDS` set, which made one row (`parent=13 child=19`)
 *   unsatisfiable; the exporter now drops it from the comparison set
 *   (`sm18-re@d3f0ce9`). The port still returns 0 so the shape matches.
 * - `element_type` (`0x00`) — **action-dependent.** An extract preserves its
 *   source's type; a cloze deletion always yields an Item, because the cloze
 *   *is* the question/answer pair.
 *
 * Plus the two fields that exist only on a child:
 *
 * - `source_article` (`0x5d`) — "Element number of the article this element was
 *   extracted from." This is the caller's parent element number, which is why
 *   it is a `MakeOptions` input rather than something read off `parent`: the
 *   parent projection carries no element number of its own.
 * - `extraction_date` (`0x4d`) — a Delphi `TDateTime` double, "when the element
 *   was extracted from its `source_article`". Caller-supplied, because it is
 *   the wall-clock instant of the user's action.
 *
 * ## Component skeleton
 *
 * `component_types` is the sequence of `component_type` bytes on the child's
 * `compon.dat` record — the component shape, carrying no user text. Type 13
 * (`0x1c`-byte buffer in the type/size table in
 * `sm18-re:docs/findings/compon.md`) is the dominant type. An extract gets one
 * component — the extracted passage. A cloze gets two — question and answer.
 * Both hold across all 12 fixture rows.
 */

/** `element_type` values, from `ELEMENT_TYPES` in `smfmt/element_info.py`. */
export const ELEMENT_TYPE_TOPIC = 0;
export const ELEMENT_TYPE_ITEM = 1;

/**
 * `compon.dat` component type 13: a `0x1c`-byte buffer in the type/size table
 * that `FUN_00902ba8` enforces, and the type that dominates observed component
 * frequencies across all six collection copies.
 *
 * Deliberately not named `TEXT`: `sm18-re:docs/findings/compon.md` settles the
 * type's size and its frequency but does not pin which entry of the
 * `Text`/`Spell`/`HTML`/... name table code 13 maps to.
 */
export const COMPONENT_TYPE_DEFAULT = 13;

/** The projection of an SM-18 `ElementInfo` record these factories may read. */
export interface ParentFields {
  element_type: number;
  concept_group_member: number;
  concept_definition_member: number;
  comment_registry_member: number;
}

/** The user-action inputs: which element was read, and when it was acted on. */
export interface MakeOptions {
  /** Element number of the parent, stored on the child as `source_article`. */
  source_article: number;
  /** Delphi `TDateTime` of the user's action. Omitted means "not extracted". */
  extraction_date?: number;
}

/** The child projection these factories produce. */
export interface ChildRecord extends ParentFields {
  source_article: number;
  extraction_date: number;
  /** `component_type` bytes of the child's `compon.dat` record, in order. */
  component_types: number[];
}

/**
 * The part of the child that is the same for every IR action: the one proven
 * inherited field, the two per-element registry slots reset to "unassigned",
 * and the child-only provenance pair.
 */
function inheritCommon(
  parent: ParentFields,
  opts: MakeOptions,
): Omit<ChildRecord, "element_type" | "component_types"> {
  return {
    // Proven inherited: 12,437 of 12,437 extract pairs.
    concept_group_member: parent.concept_group_member,
    // One-to-one back pointers, assigned per element and never by descent.
    concept_definition_member: 0,
    comment_registry_member: 0,
    source_article: opts.source_article,
    extraction_date: opts.extraction_date ?? 0,
  };
}

/**
 * Child element for an extract: the user selected a passage of `parent` and
 * pulled it out as its own element.
 *
 * An extract preserves its source's `element_type` — an extract of a Topic is a
 * Topic you can keep reading — and gets a single component for the extracted
 * passage.
 */
export function makeExtractChild(
  parent: ParentFields,
  opts: MakeOptions,
): ChildRecord {
  return {
    ...inheritCommon(parent, opts),
    element_type: parent.element_type,
    component_types: [COMPONENT_TYPE_DEFAULT],
  };
}

/**
 * Child element for a cloze deletion: the user blanked a span of `parent`,
 * turning it into a question.
 *
 * A cloze is always an Item regardless of the source's type, and carries two
 * components — question and answer.
 */
export function makeClozeChild(
  parent: ParentFields,
  opts: MakeOptions,
): ChildRecord {
  return {
    ...inheritCommon(parent, opts),
    element_type: ELEMENT_TYPE_ITEM,
    component_types: [COMPONENT_TYPE_DEFAULT, COMPONENT_TYPE_DEFAULT],
  };
}

// ---------------------------------------------------------------------------
// SM-20 verified binary algorithms (Ghidra-backed from sm20-re:smfmt/scheduler.py)
// ---------------------------------------------------------------------------

export const SM20_MAX_INTERVAL_DAYS = 44_530;
export const SM20_IMAGE_EXTRACT_AFACTOR = 1.3;

export function roundHalfToEven(x: number): number {
  if (!Number.isFinite(x)) return 1;
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return Math.round(x);
}

export function rationalSaturationZeroGuarded(a: number, b: number): number {
  if (a + b === 0) return 0;
  return a / (a + b);
}

export function computeTopicAFactorFromTextLength(textLen: number): number {
  if (!Number.isFinite(textLen) || textLen <= 0) return 2.0;
  const t = 10000.0 / textLen;
  return 1.25 + (t * 0.75) / (t + 50.0);
}

export function inheritExtractAFactor(parentAf: number, textLen: number): number {
  const fLen = computeTopicAFactorFromTextLength(textLen);
  const safeParent = Number.isFinite(parentAf) ? parentAf : 2.0;
  const t = Math.max(safeParent - 1.01, 0.0);
  const w = 0.9 - (t * 0.9) / (t + 0.29);
  const blended = safeParent * w + fLen * (1.0 - w);
  return Math.min(Math.max(blended, 1.2), 6.9);
}

export function decayParentAFactorOnExtract(parentAf: number): number {
  const safeParent = Number.isFinite(parentAf) ? parentAf : 2.0;
  return Math.min(Math.max((safeParent - 1.01) * 0.95 + 1.01, 1.01), 6.9);
}

export function computeExtractAFactorPair(
  parentAf: number,
  textLen: number,
): { childAFactor: number; parentAFactorAfter: number } {
  return {
    childAFactor: inheritExtractAFactor(parentAf, textLen),
    parentAFactorAfter: decayParentAFactorOnExtract(parentAf),
  };
}

export function adjustTopicAFactor(
  af: number,
  oldIv: number,
  newIv: number,
  hard = false,
): number {
  const safeAf = Number.isFinite(af) && af >= 1.01 ? af : 2.0;
  const a = Math.max(1, Math.trunc(oldIv));
  const b = Math.max(1, Math.trunc(newIv));
  if (a === b) return Math.min(Math.max(safeAf, 1.01), 6.0);
  const ratio = Math.max(a, b) / Math.min(a, b);
  const halfPoint = hard ? 80.0 : 15.0;
  const f = rationalSaturationZeroGuarded(ratio, halfPoint);
  const delta = Math.max((safeAf - 1.01) * f, 0.001);
  const updated = b > a ? safeAf + delta : safeAf - delta;
  return Math.min(Math.max(updated, 1.01), 6.0);
}

export function disperseScheduledInterval(
  x: number,
  d: number,
  rng?: () => number,
): number {
  if (!rng) return Math.max(1.0, x);
  let dClamped = Math.max(d, 4.0);
  dClamped = Math.min(dClamped, x + 4.0);
  dClamped = Math.min(Math.max(dClamped, 0.0), 100.0);
  const r1 = Math.min(Math.max(rng(), 0.0), 0.999999);
  let m = -10.857763300760043 * Math.log(1.0 - (r1 / 2.0) * 1.979793637145314);
  const r2 = rng();
  if (r2 > 0.5) m = -m;
  return Math.max(1.0, x + (m / 50.0) * dClamped);
}

export function computeTopicNextIntervalDays(
  oldIv: number,
  af: number,
  rng?: () => number,
): number {
  const cleanOld = Math.max(0, Math.trunc(oldIv || 0));
  const a = Math.min(Math.max(Number.isFinite(af) ? af : 2.0, 1.01), 3.0);
  const base = cleanOld === 0 ? a * a * a : cleanOld * a;
  const x = roundHalfToEven(Math.min(base, SM20_MAX_INTERVAL_DAYS));
  const d = x - cleanOld;
  const r = roundHalfToEven(disperseScheduledInterval(x, d, rng));
  return Math.min(SM20_MAX_INTERVAL_DAYS, r <= cleanOld ? cleanOld + 1 : r);
}

export function spreadExtractPriority(
  parentPriority: number,
  textLen: number,
  rng: () => number = Math.random,
): number {
  const p = Math.min(100.0, Math.max(0.0, Number.isFinite(parentPriority) ? parentPriority : 33.0));
  const t = p > 0.0 ? Math.exp(1.7 * Math.pow(p, 0.2)) : 0.0;
  let lo = p * 0.7;
  let hi = t;
  if (lo > t) {
    lo = t;
    hi = t * 1.3;
  }
  hi = Math.min(Math.max(hi, 0.0), 100.0);
  const cleanLen = Math.max(0, textLen || 0);
  const lenWeight = cleanLen > 0 ? cleanLen / (cleanLen + 100.0) : 0.0;
  const u = Math.min(1.0, Math.max(0.0, rng()));
  const res = lo + (hi - lo) * lenWeight * u;
  return Math.min(Math.max(res, 0.0), 100.0);
}

export function getPriorityDeltaForItemGrade(
  grade: number | "again" | "hard" | "good" | "easy",
  scale: "fsrs" | "sm" = "fsrs",
): number {
  if (typeof grade === "string") {
    if (grade === "hard") return 0.05;
    if (grade === "good") return 0.15;
    if (grade === "easy") return 0.3;
    return 0.0;
  }
  if (scale === "sm") {
    if (grade === 3) return 0.05;
    if (grade === 4) return 0.15;
    if (grade === 5) return 0.3;
    return 0.0;
  }
  if (grade === 2) return 0.05;
  if (grade === 3) return 0.15;
  if (grade === 4) return 0.3;
  return 0.0;
}

export function priorityPercentageToQueuePos(
  priority: number,
  collectionSize: number,
): number {
  const total = Math.max(1, Math.trunc(collectionSize));
  if (total <= 1) return 1;
  const clamped = Math.min(100.0, Math.max(0.0, Number.isFinite(priority) ? priority : 0.0));
  const idx = roundHalfToEven((clamped / 100.0) * (total - 1));
  return Math.min(total, Math.max(1, idx + 1));
}

export function queuePosToPriorityPercentage(
  pos: number,
  collectionSize: number,
): number {
  const total = Math.max(1, Math.trunc(collectionSize));
  if (pos < 2 || total <= 1) return 0.0;
  const clampedPos = Math.min(total, Math.max(1, Math.trunc(pos)));
  return ((clampedPos - 1) / (total - 1)) * 100.0;
}

export function adjustTopicPriorityAfterCommit(
  priority: number,
  oldIv: number,
  newIv: number,
  collectionSize = 100,
  hard = false,
): number {
  const total = Math.max(1, Math.trunc(collectionSize));
  let p = Math.min(100.0, Math.max(0.0, Number.isFinite(priority) ? priority : 0.0));
  const oldPos = priorityPercentageToQueuePos(p, total);
  const a = Math.max(1, Math.trunc(oldIv || 0));
  const b = Math.max(1, Math.trunc(newIv || 0));
  if (a === b) return p;

  const dVar3 = b < a ? b / a : a / b;
  let step = (1.0 - dVar3) * 80.0;
  if (hard) step /= 3.0;
  const scale = (100.0 - step) / 100.0;
  if (b < a) {
    p = p * scale;
  } else if (scale > 0) {
    p = p / scale;
  } else {
    p = 100.0;
  }
  p = Math.min(100.0, Math.max(0.0, p));

  let newPos = priorityPercentageToQueuePos(p, total);
  if (newPos === oldPos && total > 1) {
    newPos = b < a ? Math.max(1, newPos - 1) : Math.min(total, newPos + 1);
    p = queuePosToPriorityPercentage(newPos, total);
  }
  return Math.min(100.0, Math.max(0.0, p));
}

/** `FUN_00b2c950` (`0x00b2c950`). */
export function sliderToRepSortFactor(pos0To100: number): number {
  const pos = Math.min(100.0, Math.max(0.0, Number.isFinite(pos0To100) ? pos0To100 : 0.0));
  if (pos >= 100.0) return 1000.0;
  if (pos <= 0.0) return 0.001;
  const x = Math.sqrt(pos / 100.0);
  return x <= 0.5 ? x + 0.5 : (x - 0.5) * 38.0 + 1.0;
}

/** `ConvertRepSortWeightToTrackBarPosition` (`0x00b2c9f0`). */
export function repSortFactorToSlider(weight: number): number {
  if (!Number.isFinite(weight) || weight < 0.5) return 0;
  if (weight >= 20.0) return 100;
  const x = weight <= 1.0 ? weight - 0.5 : (weight - 1.0) / 38.0 + 0.5;
  return Math.min(100, Math.max(0, roundHalfToEven(x * x * 100.0)));
}

/** `TDatabase_SetBlendedQueuePositionOrdinal` (`0x00d649c0`). */
export function computeBlendedQueueOrdinal(
  basePos: number,
  queuePos: number | null | undefined,
  queueLen: number,
  weight01: number,
): number {
  const w = Math.min(1.0, Math.max(0.0, Number.isFinite(weight01) ? weight01 : 0.0));
  const fallback = Math.max(0, Math.trunc(Number.isFinite(queueLen) ? queueLen : 0)) + 1;
  const qPos =
    typeof queuePos === "number" && Number.isFinite(queuePos) && queuePos >= 1
      ? queuePos
      : fallback;
  return basePos * (1.0 - w) + qPos * w;
}

/** `FUN_00ca0ac0` (`0x00ca0ac0`). */
export function priorityToBucket20(priority: number): number {
  const p = Math.min(100.0, Math.max(0.0, Number.isFinite(priority) ? priority : 0.0));
  if (p < 0.0001) return 1;
  return Math.min(20, Math.max(1, roundHalfToEven(20.0 * Math.pow(p / 100.0, 0.25))));
}

/**
 * `GetLog2IntervalDistributionBucket` (`0x00cfc860`, #71):
 * maps `intervalDays` into 13 log2 buckets (`1..13`, upper bounds `2^0..2^11` and `4096+`)
 * with SM-20's `-0.1` day boundary tolerance.
 */
export function getLog2IntervalDistributionBucket(intervalDays: number): number {
  const iv = Number.isFinite(intervalDays) ? intervalDays : 0;
  const shifted = iv - 0.1;
  for (let b = 1; b < 13; b += 1) {
    if (shifted <= Math.pow(2, b - 1)) return b;
  }
  return 13;
}

/** `FUN_00b86810` (`0x00b86810`). */
export function postponeCeilingForPriority(
  priority: number,
  minIv: number,
  maxIv: number,
): number {
  const lo = Math.max(0, Math.trunc(Number.isFinite(minIv) ? minIv : 0));
  const hi = Math.max(lo, Math.trunc(Number.isFinite(maxIv) ? maxIv : lo));
  const p = Math.min(100.0, Math.max(0.0, Number.isFinite(priority) ? priority : 50.0));
  return lo + roundHalfToEven(((hi - lo) * p) / 100.0);
}

export interface RepSortPositionPoint {
  position: number;
  inversePriority: number;
}

/**
 * Simulate the `(queue_position, 100 - P)` curve produced by `sliderToRepSortFactor`
 * for a given jitter strength (`0..1`) over `count` uniformly prioritized items.
 */
export function simulateRepSortPositionCurve(
  sliderStrength01: number,
  count = 24,
): RepSortPositionPoint[] {
  const n = Math.max(2, Math.trunc(count));
  const strength = Math.min(1.0, Math.max(0.0, Number.isFinite(sliderStrength01) ? sliderStrength01 : 0.0));
  const ordered = Array.from({ length: n }, (_, idx) => ({
    idx,
    priority: (idx / (n - 1)) * 100.0,
  }));
  if (strength <= 0) {
    return ordered.map((item, pos) => ({
      position: pos / (n - 1),
      inversePriority: 100.0 - item.priority,
    }));
  }
  const factor = sliderToRepSortFactor(strength * 100.0);
  const maxDisp = Math.min(n, Math.max(1, Math.ceil((factor / 20.0) * Math.sqrt(n))));
  const permuted = ordered
    .map((item) => {
      let h = Math.imul((item.idx + 1) ^ 0x9e3779b9, 0x45d9f3b) >>> 0;
      h ^= h >>> 16;
      const unit = h / 0x1_0000_0000;
      return { item, key: item.idx + (unit * 2.0 - 1.0) * maxDisp };
    })
    .sort((a, b) => a.key - b.key || a.item.idx - b.item.idx);
  return permuted.map(({ item }, pos) => ({
    position: pos / (n - 1),
    inversePriority: 100.0 - item.priority,
  }));
}
