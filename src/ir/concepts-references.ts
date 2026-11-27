/**
 * SuperMemo 20 Concept Groups (`registry/concept.dat` `0x00def250`) and
 * Propagating Reference Metadata (`#SuperMemo Reference:` / `TReferences`),
 * synced bidirectionally between vault YAML frontmatter (`ir_concept`, `ir_ref`)
 * and the `.ir/` ledger.
 */

import type { ElementId } from "./ids";
import { clampPriority, type IrElement, type ReferenceMetadata } from "./model";

export type { ReferenceMetadata };

export interface ConceptGroup {
  id: string;
  name: string;
  rootElementId?: ElementId | null;
  targetFolder?: string;
  defaultPriority?: number;
  topicTemplate?: string;
  itemTemplate?: string;
  updatedAt: number;
}

export interface ConceptRegistryState {
  version: 1;
  concepts: ConceptGroup[];
}

export function createEmptyConceptRegistry(): ConceptRegistryState {
  return { version: 1, concepts: [] };
}

export function slugifyConceptId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `concept_${slug || "default"}`;
}

export function normalizeConceptRegistry(raw: unknown): ConceptRegistryState {
  if (!raw || typeof raw !== "object") return createEmptyConceptRegistry();
  const rec = raw as Partial<ConceptRegistryState>;
  if (!Array.isArray(rec.concepts)) return createEmptyConceptRegistry();
  const concepts: ConceptGroup[] = [];
  const seen = new Set<string>();
  for (const item of rec.concepts) {
    if (!item || typeof item !== "object") continue;
    const c = item as Partial<ConceptGroup>;
    if (typeof c.name !== "string" || !c.name.trim()) continue;
    const id = typeof c.id === "string" && c.id.trim() ? c.id.trim() : slugifyConceptId(c.name);
    if (seen.has(id)) continue;
    seen.add(id);
    concepts.push({
      id,
      name: c.name.trim(),
      ...(c.rootElementId !== undefined ? { rootElementId: c.rootElementId } : {}),
      ...(typeof c.targetFolder === "string" && c.targetFolder.trim()
        ? { targetFolder: c.targetFolder.trim() }
        : {}),
      ...(typeof c.defaultPriority === "number" && Number.isFinite(c.defaultPriority)
        ? { defaultPriority: clampPriority(c.defaultPriority) }
        : {}),
      ...(typeof c.topicTemplate === "string" && c.topicTemplate
        ? { topicTemplate: c.topicTemplate }
        : {}),
      ...(typeof c.itemTemplate === "string" && c.itemTemplate
        ? { itemTemplate: c.itemTemplate }
        : {}),
      updatedAt: typeof c.updatedAt === "number" && Number.isFinite(c.updatedAt) ? c.updatedAt : 0,
    });
  }
  return { version: 1, concepts };
}

export function upsertConceptGroup(
  state: ConceptRegistryState,
  group: ConceptGroup,
): ConceptRegistryState {
  const id = group.id.trim() || slugifyConceptId(group.name);
  const clean: ConceptGroup = {
    ...group,
    id,
    name: group.name.trim(),
  };
  const next = state.concepts.filter((c) => c.id !== id);
  next.push(clean);
  return { version: 1, concepts: next };
}

export function findConceptByNameOrId(
  state: ConceptRegistryState,
  query: string,
): ConceptGroup | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  return state.concepts.find(
    (c) => c.id === trimmed || c.name.toLowerCase() === lower || slugifyConceptId(trimmed) === c.id,
  );
}

export function applyConceptTemplate(template: string | undefined, content: string): string {
  if (!template || !template.trim()) return content;
  if (template.includes("{{content}}")) {
    return template.replace(/\{\{content\}\}/g, content);
  }
  return `${template.trimEnd()}\n\n${content}`;
}

export function resolveChildConceptRouting(
  sourceFrontmatter: Record<string, unknown> | null | undefined,
  registry: ConceptRegistryState | undefined,
  childType: "extract" | "item",
  rawBody: string,
  fallbackFolder: string,
  fallbackPriority: number,
): {
  concept?: ConceptGroup;
  folder: string;
  priority: number;
  body: string;
} {
  const fmConcept = readConceptFromFrontmatter(sourceFrontmatter);
  const concept =
    fmConcept && registry ? findConceptByNameOrId(registry, fmConcept) : undefined;
  if (!concept) {
    return {
      folder: fallbackFolder,
      priority: fallbackPriority,
      body: rawBody,
    };
  }
  const folder = concept.targetFolder?.trim() || fallbackFolder;
  const priority =
    concept.defaultPriority !== undefined && Number.isFinite(concept.defaultPriority)
      ? clampPriority(concept.defaultPriority)
      : fallbackPriority;
  const tpl = childType === "item" ? concept.itemTemplate : concept.topicTemplate;
  const body = applyConceptTemplate(tpl, rawBody);
  return { concept, folder, priority, body };
}

// --- SuperMemo `#SuperMemo Reference:` footer codec -------------------------

const SM_REF_HEADER_RE = /(?:^|\r?\n)#SuperMemo Reference:\s*(?:\r?\n|$)/i;

export function normalizeReference(ref: Partial<ReferenceMetadata> | null | undefined): ReferenceMetadata | null {
  if (!ref || typeof ref !== "object") return null;
  const out: ReferenceMetadata = {};
  const keys = ["title", "author", "date", "source", "link", "email", "comment"] as const;
  let any = false;
  for (const k of keys) {
    const val = ref[k];
    if (typeof val === "string" && val.trim().length > 0) {
      out[k] = val.trim();
      any = true;
    }
  }
  return any ? out : null;
}

export function areReferencesEqual(
  a: ReferenceMetadata | null | undefined,
  b: ReferenceMetadata | null | undefined,
): boolean {
  const na = normalizeReference(a);
  const nb = normalizeReference(b);
  if (na === null && nb === null) return true;
  if (na === null || nb === null) return false;
  const keys = ["title", "author", "date", "source", "link", "email", "comment"] as const;
  return keys.every((k) => (na[k] ?? "") === (nb[k] ?? ""));
}

export function parseSuperMemoReferenceFooter(text: string): ReferenceMetadata | null {
  const match = SM_REF_HEADER_RE.exec(text);
  if (!match) return null;
  const tail = text.slice(match.index + match[0].length);
  const draft: Partial<ReferenceMetadata> = {};
  for (const rawLine of tail.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(1, colon).trim().toLowerCase();
    const val = line
      .slice(colon + 1)
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!val) continue;
    if (key === "title") draft.title = val;
    else if (key === "author" || key === "sender") draft.author = val;
    else if (key === "date" || key === "sent") draft.date = val;
    else if (key === "source" || key === "page") draft.source = val;
    else if (key === "link" || key === "url") draft.link = val;
    else if (key === "e-mail" || key === "email") draft.email = val;
    else if (key === "comment") draft.comment = val;
  }
  return normalizeReference(draft);
}

export function stripSuperMemoReferenceFooter(text: string): string {
  const match = SM_REF_HEADER_RE.exec(text);
  if (!match) return text;
  return text.slice(0, match.index).trimEnd();
}

export function formatSuperMemoReferenceFooter(ref: ReferenceMetadata): string {
  const norm = normalizeReference(ref);
  if (!norm) return "";
  const lines = ["#SuperMemo Reference:"];
  if (norm.title) lines.push(`#Title: ${norm.title}`);
  if (norm.author) lines.push(`#Author: ${norm.author}`);
  if (norm.date) lines.push(`#Date: ${norm.date}`);
  if (norm.source) lines.push(`#Source: ${norm.source}`);
  if (norm.link) lines.push(`#Link: ${norm.link}`);
  if (norm.email) lines.push(`#E-mail: ${norm.email}`);
  if (norm.comment) lines.push(`#Comment: ${norm.comment}`);
  return lines.join("\n");
}

// --- Frontmatter (`ir_concept`, `ir_ref`) <-> Ledger sync -------------------

export function readConceptFromFrontmatter(
  fm: Record<string, unknown> | null | undefined,
): string | null {
  if (!fm) return null;
  const raw = fm.ir_concept ?? fm["ir-concept"];
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  return null;
}

export function writeConceptToFrontmatter(
  fm: Record<string, unknown>,
  conceptName: string | null | undefined,
): void {
  if (conceptName && conceptName.trim().length > 0) {
    fm.ir_concept = conceptName.trim();
  } else {
    delete fm.ir_concept;
  }
}

export function readReferenceFromFrontmatter(
  fm: Record<string, unknown> | null | undefined,
): ReferenceMetadata | null {
  if (!fm) return null;
  const explicit = fm.ir_ref ?? fm["ir-ref"];
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    const rec = explicit as Record<string, unknown>;
    return normalizeReference({
      title: typeof rec.title === "string" ? rec.title : undefined,
      author: typeof rec.author === "string" ? rec.author : undefined,
      date: typeof rec.date === "string" || typeof rec.date === "number" ? String(rec.date) : undefined,
      source: typeof rec.source === "string" ? rec.source : undefined,
      link: typeof rec.link === "string" ? rec.link : undefined,
      email: typeof rec.email === "string" ? rec.email : undefined,
      comment: typeof rec.comment === "string" ? rec.comment : undefined,
    });
  }
  // Fallback harvest from standard Obsidian bibliography frontmatter keys
  return normalizeReference({
    author: typeof fm.author === "string" ? fm.author : undefined,
    source: typeof fm.source === "string" ? fm.source : undefined,
    link: typeof fm.url === "string" ? fm.url : undefined,
    date: typeof fm.date === "string" || typeof fm.date === "number" ? String(fm.date) : undefined,
  });
}

export function writeReferenceToFrontmatter(
  fm: Record<string, unknown>,
  ref: ReferenceMetadata | null | undefined,
): void {
  const norm = normalizeReference(ref);
  if (!norm) {
    delete fm.ir_ref;
    return;
  }
  fm.ir_ref = { ...norm };
}

/**
 * Walks up the ancestor `parentId` chain to resolve inherited `ConceptGroup`
 * and `ReferenceMetadata` when creating extracts or items.
 */
export function resolveInheritedConceptAndReference(
  element: Pick<IrElement, "id" | "parentId" | "conceptId" | "reference">,
  elementsById: ReadonlyMap<string, IrElement>,
  registry: ConceptRegistryState,
): {
  concept: ConceptGroup | undefined;
  conceptId: string | undefined;
  reference: ReferenceMetadata | undefined;
} {
  let foundConceptId = element.conceptId;
  let foundRef = normalizeReference(element.reference) ?? undefined;

  const visited = new Set<string>([element.id]);
  let curId: string | null = element.parentId;
  while (curId && !visited.has(curId)) {
    visited.add(curId);
    const anc = elementsById.get(curId);
    if (!anc) break;
    if (!foundConceptId && anc.conceptId) {
      foundConceptId = anc.conceptId;
    }
    if (!foundRef && anc.reference) {
      foundRef = normalizeReference(anc.reference) ?? undefined;
    }
    if (!foundConceptId) {
      const rootMatch = registry.concepts.find((c) => c.rootElementId === anc.id);
      if (rootMatch) foundConceptId = rootMatch.id;
    }
    curId = anc.parentId;
  }

  const concept = foundConceptId ? findConceptByNameOrId(registry, foundConceptId) : undefined;
  return {
    concept,
    conceptId: concept?.id ?? foundConceptId,
    reference: foundRef,
  };
}

/**
 * Reconciles YAML frontmatter (`ir_concept`, `ir_ref`) against an element's
 * ledger state. Auto-registers a new `ConceptGroup` when the user types an
 * unseen `ir_concept` name in YAML. Returns `changed: false` when already in sync.
 */
export function reconcileNoteFrontmatterWithLedger(
  element: IrElement,
  frontmatter: Record<string, unknown> | null | undefined,
  registry: ConceptRegistryState,
  nowMs: number,
): {
  changed: boolean;
  conceptId: string | null;
  reference: ReferenceMetadata | null;
  nextRegistry: ConceptRegistryState;
} {
  let nextRegistry = registry;
  const fmConceptRaw = readConceptFromFrontmatter(frontmatter);
  let targetConceptId: string | null = element.conceptId ?? null;

  if (fmConceptRaw !== null) {
    let group = findConceptByNameOrId(nextRegistry, fmConceptRaw);
    if (!group) {
      group = {
        id: slugifyConceptId(fmConceptRaw),
        name: fmConceptRaw,
        updatedAt: nowMs,
      };
      nextRegistry = upsertConceptGroup(nextRegistry, group);
    }
    targetConceptId = group.id;
  } else if (frontmatter && ("ir_concept" in frontmatter || "ir-concept" in frontmatter)) {
    targetConceptId = null;
  }

  const hasExplicitRefKey =
    Boolean(frontmatter) && ("ir_ref" in frontmatter! || "ir-ref" in frontmatter!);
  const parsedRef = readReferenceFromFrontmatter(frontmatter);
  const targetRef: ReferenceMetadata | null =
    parsedRef !== null
      ? parsedRef
      : hasExplicitRefKey
        ? null
        : normalizeReference(element.reference);

  const conceptChanged = (element.conceptId ?? null) !== targetConceptId;
  const refChanged = !areReferencesEqual(element.reference, targetRef);

  return {
    changed: conceptChanged || refChanged,
    conceptId: targetConceptId,
    reference: targetRef,
    nextRegistry,
  };
}
