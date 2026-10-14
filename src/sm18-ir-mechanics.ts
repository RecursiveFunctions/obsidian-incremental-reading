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
 *   so it is 0. See DIVERGENCE below.
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
 *
 * ## DIVERGENCE (one fixture row cannot pass)
 *
 * Fixture row `parent=13 child=19` (an extract) expects
 * `comment_registry_member = 3` while its parent's is 0. Children 17, 18 and 19
 * all have `source_article` 13, byte-identical parent projections and the same
 * `extraction_date`, yet expect 0, 0 and 3. No deterministic function of
 * `(parent, opts)` can return three different values for three identical
 * inputs, so that row is unsatisfiable by construction.
 *
 * It is also not a real inheritance: element 19 is an extract that later had a
 * comment attached, taking Comment registry slot 3. The fixture generator's
 * `INHERITED_FIELDS` tuple lists `comment_registry_member` as inheritable,
 * which our own evidence contradicts. This port keeps the evidence-backed rule
 * (a new child has no comment) and lets that row fail rather than gaming it
 * with a call counter. `sm18-re:docs/findings/port-ir-mechanics.md` records it.
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
