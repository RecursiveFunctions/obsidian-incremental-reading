/**
 * Build the neural-review adjacency list from the IR element tree plus a
 * note-link index (wikilinks / backlinks / tags). No Obsidian imports.
 */

import type { IrElement } from "./model";
import type { LogState } from "./log";
import type { ElementId } from "./ids";
import {
  GROUP_P,
  WIKILINK_DEGREE_CAP,
  capWikilinkNeighbors,
  type NeuralEdgeKind,
  type NeuralNeighbor,
} from "./neural";

export interface NoteLinkIndex {
  outgoing(path: string): readonly string[];
  incoming(path: string): readonly string[];
  tags(path: string): readonly string[];
  aliases?(path: string): readonly string[];
}

export type NeuralAdjacency = Map<string, NeuralNeighbor[]>;

export function emptyLinkIndex(): NoteLinkIndex {
  return {
    outgoing: () => [],
    incoming: () => [],
    tags: () => [],
  };
}

/**
 * Undirected adjacency: tree (parent/child/sibling) plus wikilinks between
 * IR notes, including a single unmarked-note relay so A → Bridge → B
 * still connects A and B.
 */
const LEXICAL_STOPWORDS = new Set([
  "about", "above", "after", "again", "against", "almost", "alone", "along", "already", "also",
  "although", "always", "among", "another", "anyone", "anything", "around", "because", "become",
  "before", "behind", "being", "below", "between", "both", "cannot", "could", "doing", "during",
  "each", "either", "enough", "even", "every", "everything", "first", "following", "from", "further",
  "given", "have", "having", "here", "hers", "herself", "himself", "however", "into", "itself",
  "just", "keep", "know", "large", "last", "later", "least", "less", "like", "likely", "long",
  "made", "make", "many", "maybe", "mean", "might", "more", "most", "mostly", "much", "must",
  "myself", "near", "need", "neither", "never", "next", "none", "note", "notes", "nothing",
  "often", "only", "other", "others", "otherwise", "ours", "ourselves", "over", "part", "perhaps",
  "possible", "probably", "quite", "rather", "really", "same", "several", "shall", "should",
  "since", "some", "somehow", "someone", "something", "sometimes", "somewhat", "still", "such",
  "take", "taken", "than", "that", "their", "theirs", "them", "themselves", "then", "there",
  "therefore", "these", "they", "thing", "things", "think", "this", "those", "though", "through",
  "thus", "today", "together", "under", "until", "upon", "used", "using", "very", "want", "well",
  "were", "what", "whatever", "when", "whenever", "where", "whereas", "wherever", "whether",
  "which", "while", "whilst", "whoever", "whom", "whose", "will", "with", "within", "without",
  "would", "your", "yours", "yourself", "yourselves",
]);

const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const WORD_PATTERN = /[\p{L}\p{N}]{4,}/gu;

function noteBasename(path: string): string {
  const slash = path.lastIndexOf("/");
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf(".");
  return (dot > 0 ? file.slice(0, dot) : file).trim();
}

function tokenizeRareTerms(text: string): string[] {
  const cleaned = text.replace(URL_PATTERN, " ").toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of cleaned.matchAll(WORD_PATTERN)) {
    const tok = match[0];
    if (tok.length < 4 || LEXICAL_STOPWORDS.has(tok) || /^\d+$/.test(tok)) continue;
    if (!seen.has(tok)) {
      seen.add(tok);
      out.push(tok);
    }
  }
  return out;
}

export function buildNeuralAdjacency(
  state: LogState,
  links: NoteLinkIndex,
  opts?: {
    useTags?: boolean;
    tagDegreeCap?: number;
    useLexical?: boolean;
    lexicalDegreeCap?: number;
  },
): NeuralAdjacency {
  const adj: NeuralAdjacency = new Map();
  const add = (
    from: string,
    to: string,
    groupP: number,
    kind: NeuralEdgeKind,
    extra?: { tag?: string; term?: string },
  ) => {
    if (from === to) return;
    const list = adj.get(from) ?? [];
    const existing = list.find((n) => n.id === to);
    if (existing) {
      if (groupP < existing.groupP) {
        existing.groupP = groupP;
        existing.kind = kind;
        if (extra?.tag) existing.tag = extra.tag;
        else delete existing.tag;
        if (extra?.term) existing.term = extra.term;
        else delete existing.term;
      }
      return;
    }
    const n: NeuralNeighbor = { id: to, groupP, kind };
    if (extra?.tag) n.tag = extra.tag;
    if (extra?.term) n.term = extra.term;
    list.push(n);
    adj.set(from, list);
  };
  const addUndirected = (
    a: string,
    b: string,
    groupP: number,
    kind: NeuralEdgeKind,
    extra?: { tag?: string; term?: string },
  ) => {
    add(a, b, groupP, kind, extra);
    add(b, a, groupP, kind, extra);
  };

  const elements = [...state.elements.values()];
  const byNote = new Map<string, IrElement[]>();
  const irNotePaths = new Set<string>();
  const childrenByParent = new Map<string, IrElement[]>();

  for (const el of elements) {
    if (el.notePath) {
      irNotePaths.add(el.notePath);
      push(byNote, el.notePath, el);
    }
    if (el.anchor?.sourcePath) {
      irNotePaths.add(el.anchor.sourcePath);
      push(byNote, el.anchor.sourcePath, el);
    }
    if (el.parentId) push(childrenByParent, el.parentId, el);
  }

  for (const el of elements) {
    if (el.parentId && state.elements.has(el.parentId as ElementId)) {
      const parent = state.elements.get(el.parentId as ElementId)!;
      const parentKind: NeuralEdgeKind =
        parent.parentId === null ? "rootParent" : "parent";
      const parentP =
        parentKind === "rootParent" ? GROUP_P.rootParent : GROUP_P.parent;
      add(el.id, parent.id, parentP, parentKind);
      add(parent.id, el.id, GROUP_P.child, "child");
    }
  }

  for (const siblings of childrenByParent.values()) {
    const sorted = [...siblings].sort(
      (a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const n = sorted.length;
    if (n < 2) continue;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dist = j - i;
        const groupP =
          GROUP_P.sibling +
          (dist / Math.max(n - 1, 1)) * (GROUP_P.siblingFar - GROUP_P.sibling);
        addUndirected(sorted[i]!.id, sorted[j]!.id, groupP, "sibling");
      }
    }
  }

  for (const occupants of byNote.values()) {
    if (occupants.length < 2) continue;
    for (let i = 0; i < occupants.length; i++) {
      for (let j = i + 1; j < occupants.length; j++) {
        addUndirected(occupants[i]!.id, occupants[j]!.id, GROUP_P.child, "child");
      }
    }
  }

  for (const el of elements) {
    const path = el.notePath;
    if (!path) continue;
    const neighborNotes = linkedIrNotes(path, links, irNotePaths);
    const capped = capWikilinkNeighbors(neighborNotes, irNotePaths, WIKILINK_DEGREE_CAP);
    for (const destPath of capped) {
      for (const dest of byNote.get(destPath) ?? []) {
        if (dest.notePath === destPath) {
          addUndirected(el.id, dest.id, GROUP_P.wikilink, "wikilink");
        }
      }
    }
  }

  if (opts?.useTags) {
    const cap = opts.tagDegreeCap ?? 40;
    const byTag = new Map<string, IrElement[]>();
    for (const el of elements) {
      if (!el.notePath) continue;
      for (const tag of links.tags(el.notePath)) {
        push(byTag, tag, el);
      }
    }
    for (const [tag, members] of byTag.entries()) {
      if (members.length < 2 || members.length > cap) continue;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          addUndirected(members[i]!.id, members[j]!.id, GROUP_P.tag, "tag", { tag });
        }
      }
    }
  }

  if (opts?.useLexical) {
    const lexicalCap = Math.max(1, opts.lexicalDegreeCap ?? 10);
    const active = elements.filter((e) => !e.dismissed);
    const existingEdges = new Map<string, Set<string>>();
    for (const [k, list] of adj.entries()) {
      existingEdges.set(k, new Set(list.map((n) => n.id)));
    }

    // 1. Unlinked note-title / frontmatter-alias mentions (groupP = 0.20)
    const titlePatterns: Array<{ label: string; regex: RegExp; ownerId: string }> = [];
    for (const el of active) {
      if (!el.notePath) continue;
      const candidates = new Set<string>();
      const base = noteBasename(el.notePath);
      if (base.length >= 4 && !LEXICAL_STOPWORDS.has(base.toLowerCase())) {
        candidates.add(base);
      }
      for (const alias of links.aliases?.(el.notePath) ?? []) {
        const trimmed = alias.trim();
        if (trimmed.length >= 4 && !LEXICAL_STOPWORDS.has(trimmed.toLowerCase())) {
          candidates.add(trimmed);
        }
      }
      for (const label of candidates) {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        titlePatterns.push({
          label,
          regex: new RegExp(`\\b${escaped}\\b`, "i"),
          ownerId: el.id,
        });
      }
    }
    if (titlePatterns.length > 0) {
      for (const el of active) {
        const body = el.text ?? "";
        if (!body) continue;
        const linked = existingEdges.get(el.id);
        for (const pat of titlePatterns) {
          if (pat.ownerId === el.id || linked?.has(pat.ownerId)) continue;
          if (pat.regex.test(body)) {
            addUndirected(el.id, pat.ownerId, GROUP_P.titleMention, "titleMention", {
              term: pat.label,
            });
          }
        }
      }
    }

    // 2. Shared rare corpus terms (groupP = 0.35, 2 <= df <= max(3, floor(0.05 * N)))
    const maxDf = Math.max(3, Math.floor(0.05 * active.length));
    const termDocs = new Map<string, IrElement[]>();
    for (const el of active) {
      const rawText = [el.text ?? "", el.notePath ? noteBasename(el.notePath) : ""].join(" ");
      for (const term of tokenizeRareTerms(rawText)) {
        push(termDocs, term, el);
      }
    }
    const rareTerms = [...termDocs.entries()]
      .filter(([, docs]) => docs.length >= 2 && docs.length <= maxDf)
      .sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));

    const lexicalDegree = new Map<string, number>();
    for (const [term, docs] of rareTerms) {
      for (let i = 0; i < docs.length; i += 1) {
        const a = docs[i]!;
        if ((lexicalDegree.get(a.id) ?? 0) >= lexicalCap) continue;
        for (let j = i + 1; j < docs.length; j += 1) {
          const b = docs[j]!;
          if ((lexicalDegree.get(b.id) ?? 0) >= lexicalCap) continue;
          if (existingEdges.get(a.id)?.has(b.id)) continue;
          const prevA = adj.get(a.id)?.some((n) => n.id === b.id) ?? false;
          if (prevA) continue;
          addUndirected(a.id, b.id, GROUP_P.lexical, "lexical", { term });
          lexicalDegree.set(a.id, (lexicalDegree.get(a.id) ?? 0) + 1);
          lexicalDegree.set(b.id, (lexicalDegree.get(b.id) ?? 0) + 1);
          if ((lexicalDegree.get(a.id) ?? 0) >= lexicalCap) break;
        }
      }
    }
  }

  return adj;
}

/** Wikilink degree is capped per node at walk time so a MOC does not dump the vault, while a spoke can still reach the hub. */
export function neighborsForWalk(
  adj: NeuralAdjacency,
  id: string,
): NeuralNeighbor[] {
  const all = adj.get(id) ?? [];
  const wiki: NeuralNeighbor[] = [];
  const rest: NeuralNeighbor[] = [];
  for (const n of all) {
    (n.kind === "wikilink" ? wiki : rest).push(n);
  }
  wiki.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rest.concat(wiki.slice(0, WIKILINK_DEGREE_CAP));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function allNeighbors(path: string, links: NoteLinkIndex): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...links.outgoing(path), ...links.incoming(path)]) {
    if (p === path || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** Direct IR neighbors plus IR notes one unmarked hop away. */
function linkedIrNotes(
  path: string,
  links: NoteLinkIndex,
  irNotePaths: Set<string>,
): string[] {
  const out = new Set<string>();
  for (const n of allNeighbors(path, links)) {
    if (irNotePaths.has(n)) {
      out.add(n);
      continue;
    }
    for (const n2 of allNeighbors(n, links)) {
      if (n2 !== path && irNotePaths.has(n2)) out.add(n2);
    }
  }
  return [...out];
}
