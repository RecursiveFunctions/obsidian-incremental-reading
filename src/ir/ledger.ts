/**
 * The ledger module.
 *
 * This module implements the append-only event log ledger with persistence
 * through the injected VaultFs interface. It provides methods for initializing
 * the ledger, managing device IDs, appending events, and loading the current
 * state of the log.
 *
 * No Obsidian API, no node fs/path, all IO via the injected VaultFs.
 */

import {
  foldFrom,
  foldIntermediate,
  finalizeFold,
  emptyFoldIntermediate,
  serializeFoldIntermediate,
  deserializeFoldIntermediate,
  findLastUndoableGrade,
  compact,
  type LogState,
  type FoldIntermediate,
  type SerializedFoldIntermediate,
} from "./log";
import { newDeviceId, type DeviceId, type ElementId } from "./ids";
import { validateIrEvent, type IrEvent } from "./model";
import type { BookmarkMap } from "./bookmark";
import { parseSessionSnapshot, type SessionSnapshot } from "./session-snapshot";
import { parseDailyPriorityAnalytics, type DailyPriorityAnalytics } from "./priority-analytics";

// Fixed paths (constants in the module)
export const META = ".ir/meta.json";
export const DEVICE = ".ir/device.json";
export const LOGDIR = ".ir/log";
export const SNAPSHOT = ".ir/snapshot.jsonl";
export const RHISTDIR = ".ir/review-history";
export const COMPACTIONDIR = ".ir/compaction";
export const STATEDIR = ".ir/state";
export const TOMBSTONES = ".ir/tombstones.json";
export const BOOKMARKS = ".ir/bookmarks.json";
export const SESSION = ".ir/session.json";
export const AUTO_POSTPONE = ".ir/auto-postpone.json";
export const ANALYTICS_DIR = ".ir/analytics";
export const MIGRATION_LOG = `${LOGDIR}/dev_mig_ir_store.jsonl`;

/** `unmigrated`: `.ir/meta.json` exists but `migration: "complete"` was never committed. */
export type LedgerStatus = "absent" | "unmigrated" | "migrated" | "reset";

interface LedgerMetaV1 {
  schemaVersion: 1;
  migration?: "complete";
  reset?: "inert";
  generation?: string;
}

interface LedgerPaths {
  logDir: string;
  migrationLog: string;
  snapshot: string;
  reviewHistoryDir: string;
  compactionDir: string;
  checkpointDir: string;
  bookmarks: string;
}

/**
 * The hot read path's result. `state` is what `load()` returns; the other
 * fields exist so callers do not have to re-read the full event history to
 * answer "what is the next lamport", "where did each due last move", or
 * "what arrived recently".
 */
export interface LedgerView {
  state: LogState;
  /** Highest lamport the ledger knows; new events must exceed it. */
  maxLamport: number;
  /** Last due-changing event per element (status bar's `postponed` count). */
  lastDueChange: Map<ElementId, IrEvent["kind"]>;
  /** Events the checkpoint does not cover — the live shards. */
  recentEvents: IrEvent[];
}

const CHECKPOINT_SCHEMA = 1;
/** A fold checkpoint is only worth its file once the history is non-trivial. */
const CHECKPOINT_MIN_EVENTS = 250;

interface CheckpointView {
  seq: number;
  watermark: number;
  covered: Map<string, string>;
  intermediate: FoldIntermediate;
}

interface CheckpointPayloadV1 {
  watermark: number;
  covered: Array<[string, string]>;
  state: SerializedFoldIntermediate;
  createdAt: number;
}

interface CheckpointFileV1 {
  schemaVersion: number;
  generation: string | null;
  deviceId: string;
  seq: number;
  digest: string;
  payload: CheckpointPayloadV1;
}

/** Two independent FNV-1a passes: 64 bits is enough to detect corruption. */
function digest64(value: string): string {
  let a = 2166136261;
  let b = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    a ^= code;
    a = Math.imul(a, 16777619);
    b ^= code;
    b = Math.imul(b, 16777619);
    b ^= b >>> 13;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

function eventDigest(event: IrEvent): string {
  return digest64(deterministicJsonStringify(event));
}

function checkpointView(payload: CheckpointPayloadV1, seq: number): CheckpointView {
  const covered = new Map<string, string>();
  for (const entry of payload.covered) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error("IrLedger: invalid checkpoint coverage entry");
    }
    covered.set(String(entry[0]), String(entry[1]));
  }
  return {
    seq,
    watermark: payload.watermark,
    covered,
    intermediate: deserializeFoldIntermediate(payload.state),
  };
}

function emptyLedgerView(): LedgerView {
  return {
    state: finalizeFold(emptyFoldIntermediate()),
    maxLamport: 0,
    lastDueChange: new Map(),
    recentEvents: [],
  };
}

function viewFromIntermediate(
  intermediate: FoldIntermediate,
  watermark: number,
  recentEvents: IrEvent[],
): LedgerView {
  const lastDueChange = new Map<ElementId, IrEvent["kind"]>();
  for (const [id, record] of intermediate.dueChange) lastDueChange.set(id, record.kind);
  let maxLamport = watermark;
  for (const event of recentEvents) if (event.lamport > maxLamport) maxLamport = event.lamport;
  return {
    state: finalizeFold(intermediate),
    maxLamport,
    lastDueChange,
    recentEvents,
  };
}

export interface VaultFs {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  /** Whole-file delete; required when calling {@link IrLedger.reconcile}. */
  remove?(path: string): Promise<void>;
}

/** Recursively sort object keys so JSON.stringify is stable across key insertion order. */
function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const o = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    sorted[k] = sortKeysDeep(o[k]);
  }
  return sorted;
}

/** Strip undefined via JSON, sort keys recursively, then stringify (deterministic bytes). */
function deterministicJsonStringify(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  return JSON.stringify(sortKeysDeep(normalized));
}

function assertSameEvents(context: string, expected: readonly IrEvent[], actual: readonly IrEvent[]): void {
  const expectedById = new Map<string, string>();
  for (const event of expected) {
    const bytes = deterministicJsonStringify(event);
    const prior = expectedById.get(event.id);
    if (prior !== undefined && prior !== bytes) {
      throw new Error(`${context}: conflicting expected event id ${event.id}`);
    }
    expectedById.set(event.id, bytes);
  }
  const actualById = new Map<string, string>();
  for (const event of actual) {
    const bytes = deterministicJsonStringify(event);
    const prior = actualById.get(event.id);
    if (prior !== undefined) {
      throw new Error(`${context}: duplicate persisted event id ${event.id}`);
    }
    actualById.set(event.id, bytes);
  }
  if (expectedById.size !== actualById.size) {
    throw new Error(`${context}: persisted event count mismatch`);
  }
  for (const [id, bytes] of expectedById) {
    if (actualById.get(id) !== bytes) {
      throw new Error(`${context}: persisted event mismatch for ${id}`);
    }
  }
}

function assertSameEventSequence(
  context: string,
  expected: readonly IrEvent[],
  actual: readonly IrEvent[],
): void {
  if (expected.length !== actual.length) {
    throw new Error(`${context}: persisted event count mismatch`);
  }
  for (let index = 0; index < expected.length; index++) {
    if (deterministicJsonStringify(expected[index]) !== deterministicJsonStringify(actual[index])) {
      throw new Error(`${context}: persisted event mismatch at index ${index}`);
    }
  }
}

function assertNoConflictingEvents(
  context: string,
  existing: readonly IrEvent[],
  candidates: readonly IrEvent[],
): void {
  const byId = new Map<string, string>();
  for (const event of existing) {
    const bytes = deterministicJsonStringify(event);
    const prior = byId.get(event.id);
    if (prior !== undefined && prior !== bytes) {
      throw new Error(`${context}: conflicting duplicate event id ${event.id}`);
    }
    byId.set(event.id, bytes);
  }
  for (const event of candidates) {
    const bytes = deterministicJsonStringify(event);
    const prior = byId.get(event.id);
    if (prior !== undefined && prior !== bytes) {
      throw new Error(`${context}: conflicting duplicate event id ${event.id}`);
    }
    byId.set(event.id, bytes);
  }
}

function elementStatePath(id: string): string {
  return `${STATEDIR}/${id}.json`;
}

/** If `fullPath` is `${STATEDIR}/<id>.json`, return `<id>`; otherwise null. */
function parseElementStateId(fullPath: string): ElementId | null {
  const prefix = STATEDIR.endsWith("/") ? STATEDIR : `${STATEDIR}/`;
  if (!fullPath.startsWith(prefix)) {
    return null;
  }
  const base = fullPath.slice(prefix.length);
  if (base.includes("/")) {
    return null;
  }
  if (!base.endsWith(".json")) {
    return null;
  }
  return base.slice(0, -".json".length) as ElementId;
}

export interface StoreOptions {
  conflict?: "conservative" | "clock-order";
}

export class IrLedger {
  private fs: VaultFs;
  private opts: StoreOptions;
  private deviceId?: DeviceId;
  private generation?: string;
  private readyBarrier?: () => Promise<void>;
  private pendingShardRepairs = new Map<
    string,
    { archivePath: string; body: string; events: IrEvent[] }
  >();
  private shardAccessTail: Promise<void> = Promise.resolve();
  /**
   * Element ids whose state file we've already tried (and failed) to write
   * this session. Reconcile retries every pass otherwise, which spams the
   * console with the same ENAMETOOLONG warning on every extract / grade /
   * status-bar refresh. Dedupe lets the first failure surface clearly and
   * keeps subsequent passes quiet.
   */
  private writeFailureLogged = new Set<string>();
  /** One bootstrap attempt per session, so a failed write cannot loop. */
  private checkpointAttempted = false;
  /** Parsed checkpoint payload, keyed by generation+seq (see readCheckpoint). */
  private checkpointCache?: {
    generation: string | null;
    seq: number;
    payload: CheckpointPayloadV1;
  };

  constructor(fs: VaultFs, opts?: StoreOptions) {
    this.fs = fs;
    this.opts = opts || {};
  }

  /**
   * Delay externally initiated writes until the plugin's asynchronous ledger
   * initialization has selected and committed its generation. Migration code
   * itself does not append through this gate, so the barrier cannot deadlock
   * the generation commit it is waiting for.
   */
  setReadyBarrier(barrier: () => Promise<void>): void {
    this.readyBarrier = barrier;
  }

  private async awaitReady(): Promise<void> {
    if (this.readyBarrier) await this.readyBarrier();
  }

  private async withShardAccess<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.shardAccessTail;
    let release!: () => void;
    this.shardAccessTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  /**
   * Initialize the ledger. Optional `hostname` opts in to the per-host device
   * registry (DESIGN §Q2 fix): `.ir/device.json` becomes a `{devices:{host:id}}`
   * map so each physical Obsidian install gets its own id and its own log
   * shard, even though the file itself rides Obsidian Sync. Without a
   * hostname the caller uses the single-`deviceId` device file shape (tests
   * and non-Obsidian harnesses).
   */
  async init(opts?: { hostname?: string }): Promise<void> {
    if (!(await this.fs.exists(META))) {
      await this.fs.write(META, JSON.stringify({ schemaVersion: 1 }));
    }
    await this.initDevice(opts);
  }

  async status(): Promise<LedgerStatus> {
    if (!(await this.fs.exists(META))) return "absent";
    const meta = this.parseMeta(await this.fs.read(META));
    this.generation = meta.generation;
    if (meta.reset === "inert") return "reset";
    if (meta.migration === "complete") return "migrated";
    return "unmigrated";
  }

  async initDevice(opts?: { hostname?: string }): Promise<void> {
    if (opts?.hostname) {
      this.deviceId = await this.resolvePerHostDeviceId(opts.hostname);
      return;
    }
    if (!(await this.fs.exists(DEVICE))) {
      const id = newDeviceId();
      await this.fs.write(DEVICE, JSON.stringify({ deviceId: id }));
      this.deviceId = id;
    }
  }

  async commitMigration(events: readonly IrEvent[]): Promise<void> {
    const generation = newDeviceId();
    const migrationLog = this.pathsFor(generation).migrationLog;
    const body = events.map((event) => JSON.stringify(event) + "\n").join("");
    await this.fs.write(migrationLog, body);
    const persisted = this.parseJsonl(migrationLog, await this.fs.read(migrationLog));
    assertSameEvents("IrLedger.commitMigration", events, persisted);
    await this.fs.write(
      META,
      JSON.stringify({ schemaVersion: 1, migration: "complete", generation } satisfies LedgerMetaV1),
    );
    this.generation = generation;
  }

  async markReset(): Promise<void> {
    const generation = newDeviceId();
    await this.fs.write(
      META,
      JSON.stringify({ schemaVersion: 1, reset: "inert", generation } satisfies LedgerMetaV1),
    );
    this.generation = generation;
  }

  private parseMeta(content: string): LedgerMetaV1 {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("IrLedger: invalid meta.json");
    }
    const meta = value as Record<string, unknown>;
    if (meta.schemaVersion !== 1) {
      throw new Error(`IrLedger: unsupported schema version ${String(meta.schemaVersion)}`);
    }
    if (meta.migration !== undefined && meta.migration !== "complete") {
      throw new Error("IrLedger: invalid migration status");
    }
    if (meta.reset !== undefined && meta.reset !== "inert") {
      throw new Error("IrLedger: invalid reset status");
    }
    if (meta.generation !== undefined &&
        (typeof meta.generation !== "string" || meta.generation.length === 0)) {
      throw new Error("IrLedger: invalid generation");
    }
    return meta as unknown as LedgerMetaV1;
  }

  private pathsFor(generation = this.generation): LedgerPaths {
    const base = generation ? `.ir/generations/${generation}` : ".ir";
    const logDir = `${base}/log`;
    return {
      logDir,
      migrationLog: `${logDir}/dev_mig_ir_store.jsonl`,
      snapshot: `${base}/snapshot.jsonl`,
      reviewHistoryDir: `${base}/review-history`,
      compactionDir: `${base}/compaction`,
      checkpointDir: `${base}/checkpoint`,
      bookmarks: `${base}/bookmarks.json`,
    };
  }

  private async paths(): Promise<LedgerPaths> {
    if (this.generation === undefined && await this.fs.exists(META)) {
      this.generation = this.parseMeta(await this.fs.read(META)).generation;
    }
    return this.pathsFor();
  }

  /**
   * Read `.ir/device.json` as the per-host map (or upgrade a single-
   * `{deviceId}` file in place by treating that id as belonging to
   * *this* host — which is correct for the device that originally wrote
   * it, the most likely first-upgrade scenario). Add or read this host's
   * entry, write the file back, and return the id.
   *
   * The file format is intentionally additive: a sync from another device
   * that clobbers our entry just means we'll re-add ourselves on the next
   * load (and our cached `this.deviceId` keeps the in-memory invariant
   * stable for the session). No sync-war data loss.
   */
  private async resolvePerHostDeviceId(hostname: string): Promise<DeviceId> {
    let devices: Record<string, string> = {};
    if (await this.fs.exists(DEVICE)) {
      try {
        const parsed = JSON.parse(await this.fs.read(DEVICE)) as {
          devices?: Record<string, string>;
          deviceId?: string;
        };
        if (parsed.devices && typeof parsed.devices === "object") {
          devices = parsed.devices;
        } else if (typeof parsed.deviceId === "string" && parsed.deviceId) {
          // Single-id file → claim the id for this host. The next load on a
          // DIFFERENT host will see the new schema, miss its own hostname,
          // and generate a fresh id, which is exactly what we want.
          devices[hostname] = parsed.deviceId;
        }
      } catch {
        devices = {};
      }
    }
    let id = devices[hostname];
    if (!id) {
      id = newDeviceId();
      devices[hostname] = id;
    }
    await this.fs.write(DEVICE, JSON.stringify({ devices }));
    return id as DeviceId;
  }

  async getDeviceId(): Promise<DeviceId> {
    await this.awaitReady();
    if (this.deviceId) {
      return this.deviceId;
    }

    // Fallback for callers that skipped init() (tests, ad-hoc tools). Reads
    // either schema and picks the first id it finds, which is enough to
    // keep the shard path stable in those one-off cases.
    const deviceContent = await this.fs.read(DEVICE);
    const deviceData = JSON.parse(deviceContent) as {
      deviceId?: string;
      devices?: Record<string, string>;
    };
    if (deviceData.deviceId) {
      this.deviceId = deviceData.deviceId as DeviceId;
    } else if (deviceData.devices) {
      const first = Object.values(deviceData.devices)[0];
      if (first) this.deviceId = first as DeviceId;
    }
    if (!this.deviceId) {
      throw new Error(
        "IrLedger.getDeviceId: device.json has no readable id; init() never ran.",
      );
    }
    return this.deviceId;
  }

  async schemaVersion(): Promise<number> {
    return this.parseMeta(await this.fs.read(META)).schemaVersion;
  }

  async appendEvent(ev: IrEvent): Promise<void> {
    await this.appendEvents([ev]);
  }

  async appendEvents(events: readonly IrEvent[]): Promise<{
    landedIds: string[];
    alreadyPresentIds: string[];
  }> {
    await this.awaitReady();
    for (const event of events) {
      const issue = validateIrEvent(event);
      if (issue) throw new Error(`IrLedger.appendEvents: ${issue}`);
    }
    assertNoConflictingEvents("IrLedger.appendEvents batch", [], events);
    const result = await this.withShardAccess(async () => {
      const existingById = await this.loadEventIndexWithoutShardLock(events);
      const pending = events.filter((event) => !existingById.has(event.id));
      const alreadyPresentIds = events
        .filter((event) => existingById.has(event.id))
        .map((event) => event.id);
      if (pending.length === 0) {
        return { landedIds: [], alreadyPresentIds };
      }
      const deviceId = await this.getDeviceId();
      const { logDir } = await this.paths();
      const shardPath = `${logDir}/${deviceId}.jsonl`;
      const pendingRepair = this.pendingShardRepairs.get(shardPath);
      if (pendingRepair) {
        await this.persistShardRepair(shardPath, pendingRepair);
      }
      await this.fs.append(
        shardPath,
        pending.map((event) => JSON.stringify(event) + "\n").join(""),
      );
      return { landedIds: pending.map((event) => event.id), alreadyPresentIds };
    });

    // DESIGN Q2.3: compaction runs at plugin load and after a sync-fold,
    // never mid-review, so appends never trigger it here.
    return result;
  }

  private async persistShardRepair(
    path: string,
    repair: { archivePath: string; body: string; events: IrEvent[] },
  ): Promise<void> {
    // Preserve the complete validated prefix in a verified transaction archive
    // before touching the live shard. If the replacement itself tears, the
    // archive still carries post-compaction events that older archives lack.
    if (await this.fs.exists(repair.archivePath)) {
      const archived = this.parseJsonl(
        repair.archivePath,
        await this.fs.read(repair.archivePath),
      );
      assertSameEventSequence("IrLedger torn-shard repair archive", repair.events, archived);
    } else {
      await this.fs.write(repair.archivePath, repair.body);
      const archived = this.parseJsonl(
        repair.archivePath,
        await this.fs.read(repair.archivePath),
      );
      assertSameEventSequence("IrLedger torn-shard repair archive", repair.events, archived);
    }

    await this.fs.write(path, repair.body);
    const persisted = this.parseJsonl(path, await this.fs.read(path));
    assertSameEventSequence("IrLedger torn-shard repair", repair.events, persisted);
    this.pendingShardRepairs.delete(path);
  }

  private parseJsonl(path: string, content: string): IrEvent[] {
    const out: IrEvent[] = [];
    const lines = content.split("\n");

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const trimmedLine = line.trim();
      if (trimmedLine) {
        try {
          const event = JSON.parse(trimmedLine) as unknown;
          const issue = validateIrEvent(event);
          if (issue) throw new Error(issue);
          out.push(event as IrEvent);
        } catch (error) {
          throw new Error(`IrLedger: invalid JSONL in ${path} at line ${index + 1}: ${(error as Error).message}`);
        }
      }
    }
    return out;
  }

  /**
   * Return the strictly validated prefix of a live shard only when its final
   * record is an interrupted JSON object write. Compaction archives are
   * complete transaction records, so they can cover the lost suffix; they do
   * not authorize accepting any other malformed shard content.
   */
  private parseRecoverableTornJsonlTail(path: string, content: string): IrEvent[] | null {
    if (content.endsWith("\n")) return null;

    const tailStart = content.lastIndexOf("\n") + 1;
    const tail = content.slice(tailStart);
    if (!tail.trimStart().startsWith("{")) return null;

    // Parse every preceding line normally so malformed middle records and
    // schema-invalid records remain fail-closed with their original location.
    const prefix = this.parseJsonl(path, content.slice(0, tailStart));
    try {
      JSON.parse(tail);
      return null; // A complete JSON value must still pass normal validation.
    } catch (error) {
      if (!(error instanceof SyntaxError)) return null;
      const position = /position (\d+)/.exec(error.message);
      // V8 gives some incomplete lexical tokens (for example `1e`, `-`, and
      // `\\u00`) a specific error rather than “unexpected end”. They are torn
      // only when its parser reached the end of this final physical record.
      // A reported position before EOF is malformed content, even if V8 calls
      // the token “unterminated”.
      const errorPosition = position === null ? null : Number(position[1]);
      const endsAtTailEnd = errorPosition === tail.length;
      const endsWithoutPosition = errorPosition === null && /unexpected end/i.test(error.message);
      return endsAtTailEnd || endsWithoutPosition ? prefix : null;
    }
  }

  /**
   * Read all events from the snapshot + every device shard. Same scan
   * `load()` performs; exposed so callers that need the raw stream (stats,
   * deletion args, history exports) don't have to reach into private state.
   */
  async loadEvents(): Promise<IrEvent[]> {
    return this.withShardAccess(() => this.loadEventsWithoutShardLock());
  }

  private async readMetaForLoad(): Promise<{ reset: boolean }> {
    if (await this.fs.exists(META)) {
      const meta = this.parseMeta(await this.fs.read(META));
      this.generation = meta.generation;
      if (meta.reset === "inert") return { reset: true };
    }
    return { reset: false };
  }

  /**
   * Read every event in the active generation.
   *
   * `includeArchives: false` is the hot path: a fold checkpoint stands in for
   * the compacted-away archives, and re-reading them on every load is exactly
   * the cost compaction exists to remove. The full stream (archives included)
   * stays available for history consumers (`loadEvents`, stats, optimizer).
   */
  private async collectEventsWithoutShardLock(
    includeArchives: boolean,
    opts?: { skipMigrationLog?: boolean },
  ): Promise<IrEvent[]> {
    if ((await this.readMetaForLoad()).reset) return [];
    const paths = this.pathsFor();
    const events: IrEvent[] = [];

    if (await this.fs.exists(paths.snapshot)) {
      const snapContent = await this.fs.read(paths.snapshot);
      events.push(...this.parseJsonl(paths.snapshot, snapContent));
    }

    const archiveEntries: Array<{ path: string; events: IrEvent[] }> = [];
    if (includeArchives) {
      for (const archive of await this.fs.list(paths.compactionDir)) {
        const archiveEvents = this.parseJsonl(archive, await this.fs.read(archive));
        archiveEntries.push({ path: archive, events: archiveEvents });
        events.push(...archiveEvents);
      }
    }

    const shards = await this.fs.list(paths.logDir);
    for (const shard of shards) {
      // The migration log is written once per generation and the first
      // checkpoint always folds it; skipping it is exact, not a guess.
      if (opts?.skipMigrationLog && shard === paths.migrationLog) continue;
      const content = await this.fs.read(shard);
      try {
        events.push(...this.parseJsonl(shard, content));
      } catch (error) {
        // Torn-shard recovery needs the transaction archive as proof, so the
        // fast path defers to the archive-reading rebuild instead of guessing.
        if (!includeArchives) throw error;
        const shardName = shard.slice(shard.lastIndexOf("/") + 1).replace(/\.jsonl$/, "");
        const hasRecoveryArchive = archiveEntries.some(({ path: archive, events: archiveEvents }) => {
          const archiveName = archive.slice(archive.lastIndexOf("/") + 1);
          const transactionId = archiveEvents.map((event) => event.id).sort().join("_");
          const expectedArchiveName = `${shardName}-${hashString(transactionId)}.jsonl`;
          return archiveName === expectedArchiveName;
        });
        if (!hasRecoveryArchive) throw error;

        const recoveredPrefix = this.parseRecoverableTornJsonlTail(shard, content);
        if (recoveredPrefix === null) throw error;
        // Validate against snapshots, archives, and earlier shards before any
        // repair write. Otherwise a forged/conflicting prefix could overwrite
        // the archive that proves the conflict and appear valid on next load.
        assertNoConflictingEvents("IrLedger torn-shard recovery", events, recoveredPrefix);
        if (shardName === this.deviceId) {
          const transactionId = recoveredPrefix.map((event) => event.id).sort().join("_");
          const repair = {
            archivePath:
              `${paths.compactionDir}/${shardName}-${hashString(transactionId)}.jsonl`,
            body: recoveredPrefix.map((event) => JSON.stringify(event) + "\n").join(""),
            events: recoveredPrefix,
          };
          this.pendingShardRepairs.set(shard, repair);
          try {
            await this.persistShardRepair(shard, repair);
          } catch (repairError) {
            console.warn(
              `Incremental Reading: could not persist torn-shard repair for ${shard}; ` +
                "the next append will retry before writing",
              repairError,
            );
          }
        }
        events.push(...recoveredPrefix);
        console.warn(
          `Incremental Reading: recovered validated prefix of ${shard}; discarded a torn final JSONL line`,
        );
      }
    }

    const byId = new Map<string, IrEvent>();
    for (const event of events) {
      const prior = byId.get(event.id);
      if (prior && deterministicJsonStringify(prior) !== deterministicJsonStringify(event)) {
        throw new Error(`IrLedger: conflicting duplicate event id ${event.id}`);
      }
      byId.set(event.id, event);
    }
    return [...byId.values()];
  }

  private loadEventsWithoutShardLock(): Promise<IrEvent[]> {
    return this.collectEventsWithoutShardLock(true);
  }

  private async listCheckpointFiles(
    paths: LedgerPaths,
    deviceId: DeviceId,
  ): Promise<Array<{ path: string; seq: number }>> {
    let files: string[];
    try {
      files = await this.fs.list(paths.checkpointDir);
    } catch {
      return [];
    }
    const prefix = `${deviceId}-`;
    const out: Array<{ path: string; seq: number }> = [];
    for (const path of files) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
      const seq = Number(name.slice(prefix.length, -".json".length));
      if (Number.isInteger(seq) && seq > 0) out.push({ path, seq });
    }
    return out.sort((a, b) => b.seq - a.seq);
  }

  /**
   * Read this device's newest valid checkpoint. Two slots are kept so a torn
   * write falls back to the previous fold instead of forcing a full rebuild.
   */
  /**
   * Device id for checkpoint paths, without the init barrier: `load()` runs
   * during migration, before that barrier resolves.
   */
  private async checkpointDeviceId(): Promise<DeviceId | null> {
    if (this.deviceId) return this.deviceId;
    if (!(await this.fs.exists(DEVICE))) return null;
    try {
      const raw = JSON.parse(await this.fs.read(DEVICE)) as {
        deviceId?: string;
        devices?: Record<string, string>;
      };
      const id = raw.deviceId ?? Object.values(raw.devices ?? {})[0];
      if (!id) return null;
      this.deviceId = id as DeviceId;
      return this.deviceId;
    } catch {
      return null;
    }
  }

  /**
   * Read this device's newest checkpoint.
   *
   * Only the newest slot is consulted. Falling back to an older slot is NOT
   * safe: the shard may already have been pruned against the newer one, so an
   * older checkpoint plus the live shard could silently miss compacted
   * events. A torn newest slot therefore means "rebuild from the archives".
   */
  private async readCheckpointWithoutLock(): Promise<CheckpointView | null> {
    const deviceId = await this.checkpointDeviceId();
    if (!deviceId) return null;
    const paths = this.pathsFor();
    const candidate = (await this.listCheckpointFiles(paths, deviceId))[0];
    if (!candidate) return null;
    const cached = this.checkpointCache;
    if (cached && cached.seq === candidate.seq &&
        cached.generation === (this.generation ?? null)) {
      return checkpointView(cached.payload, candidate.seq);
    }
    try {
      const raw = JSON.parse(await this.fs.read(candidate.path)) as Partial<CheckpointFileV1>;
      if (raw.schemaVersion !== CHECKPOINT_SCHEMA) return null;
      if (raw.deviceId !== deviceId) return null;
      if ((raw.generation ?? null) !== (this.generation ?? null)) return null;
      if (raw.seq !== candidate.seq || !raw.payload) return null;
      // No re-hash here: hashing would re-serialize 3-5 MB on every cold load,
      // which is the cost this checkpoint exists to remove. A torn write fails
      // `JSON.parse` or the shape checks; anything malformed rebuilds.
      this.checkpointCache = {
        generation: this.generation ?? null,
        seq: candidate.seq,
        payload: raw.payload,
      };
      return checkpointView(raw.payload, candidate.seq);
    } catch {
      return null;
    }
  }

  private async writeCheckpointWithoutLock(
    intermediate: FoldIntermediate,
    covered: Map<string, string>,
    watermark: number,
    createdAt: number,
  ): Promise<void> {
    const paths = this.pathsFor();
    const deviceId = await this.checkpointDeviceId();
    if (!deviceId) throw new Error("IrLedger: cannot write a checkpoint without a device id");
    const existing = await this.listCheckpointFiles(paths, deviceId);
    const seq = (existing[0]?.seq ?? 0) + 1;
    const payload: CheckpointPayloadV1 = {
      watermark,
      covered: [...covered.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      state: serializeFoldIntermediate(intermediate),
      createdAt,
    };
    const file: CheckpointFileV1 = {
      schemaVersion: CHECKPOINT_SCHEMA,
      generation: this.generation ?? null,
      deviceId,
      seq,
      digest: digest64(deterministicJsonStringify(payload)),
      payload,
    };
    const path = `${paths.checkpointDir}/${deviceId}-${seq}.json`;
    await this.fs.write(path, deterministicJsonStringify(file));

    const readBack = JSON.parse(await this.fs.read(path)) as CheckpointFileV1;
    if (readBack.digest !== digest64(deterministicJsonStringify(readBack.payload))) {
      throw new Error("IrLedger: checkpoint write did not verify");
    }

    // Keep one previous slot as the crash fallback; drop anything older.
    if (this.fs.remove) {
      for (const stale of existing.slice(1)) await this.fs.remove(stale.path);
    }
    this.checkpointCache = {
      generation: this.generation ?? null,
      seq,
      payload,
    };
  }

  /**
   * Id → content digest for every event the ledger knows about, from the
   * checkpoint's coverage plus the live shards. This is what `appendEvents`
   * checks against, so an append no longer re-reads the archive history.
   */
  private async loadEventIndexWithoutShardLock(
    incoming: readonly IrEvent[],
  ): Promise<Map<string, string>> {
    if ((await this.readMetaForLoad()).reset) return new Map();
    const checkpoint = await this.readCheckpointWithoutLock();
    const byId = new Map<string, string>(checkpoint?.covered ?? []);
    let events: IrEvent[];
    try {
      events = await this.collectEventsWithoutShardLock(false, {
        skipMigrationLog: checkpoint !== null,
      });
    } catch {
      events = await this.loadEventsWithoutShardLock();
    }
    for (const event of events) {
      const digest = eventDigest(event);
      const prior = byId.get(event.id);
      if (prior !== undefined && prior !== digest) {
        throw new Error(`IrLedger: conflicting duplicate event id ${event.id}`);
      }
      byId.set(event.id, digest);
    }
    for (const event of incoming) {
      const prior = byId.get(event.id);
      if (prior !== undefined && prior !== eventDigest(event)) {
        throw new Error(`IrLedger.appendEvents: conflicting duplicate event id ${event.id}`);
      }
    }
    return byId;
  }

  async load(): Promise<LogState> {
    return (await this.loadView()).state;
  }

  /**
   * The hot read path: fold the checkpoint plus the events it does not cover
   * (the live shards), without re-reading compacted archives.
   *
   * `maxLamport` is the watermark new events must exceed; `lastDueChange`
   * feeds the status bar without scanning the full log; `recentEvents` is the
   * uncovered stream (the only events a caller may treat as "new").
   */
  async loadView(): Promise<LedgerView> {
    return this.withShardAccess(() => this.loadViewWithoutShardLock());
  }

  private async loadViewWithoutShardLock(): Promise<LedgerView> {
    if ((await this.readMetaForLoad()).reset) return emptyLedgerView();
    const checkpoint = await this.readCheckpointWithoutLock();
    if (!checkpoint) {
      // Rewrite when a checkpoint exists but failed validation (torn, foreign
      // generation); a first-ever load stays read-only, because compaction is
      // what creates the first checkpoint.
      const deviceId = await this.checkpointDeviceId();
      const hasFiles = deviceId
        ? (await this.listCheckpointFiles(this.pathsFor(), deviceId)).length > 0
        : false;
      return this.rebuildViewWithoutShardLock(hasFiles);
    }
    let events: IrEvent[];
    try {
      events = await this.collectEventsWithoutShardLock(false, { skipMigrationLog: true });
    } catch {
      // A torn shard needs the transaction archive to prove its recovered
      // prefix; rebuild from the full stream instead of guessing here.
      return this.rebuildViewWithoutShardLock(true);
    }

    const uncovered: IrEvent[] = [];
    for (const event of events) {
      const digest = checkpoint.covered.get(event.id);
      if (digest === undefined) {
        uncovered.push(event);
        continue;
      }
      if (digest !== eventDigest(event)) return this.rebuildViewWithoutShardLock(true);
    }

    // A checkpoint covers a lamport prefix. An uncovered event below the
    // watermark would have to be replayed *before* already-folded events, so
    // the only correct response is a full rebuild.
    for (const event of uncovered) {
      if (event.lamport <= checkpoint.watermark) return this.rebuildViewWithoutShardLock(true);
    }

    // An undo of a grade already folded into the checkpoint cannot be applied
    // incrementally (the pre-grade card is gone); rebuild from the archives.
    const uncoveredIds = new Set<string>(uncovered.map((event) => event.id));
    for (const event of uncovered) {
      if (event.kind !== "grade-undone") continue;
      const target = event.payload.eventId as string | undefined;
      if (target && checkpoint.covered.has(target) && !uncoveredIds.has(target)) {
        return this.rebuildViewWithoutShardLock(true);
      }
    }

    foldFrom(checkpoint.intermediate, uncovered, { conflict: this.opts.conflict });
    return viewFromIntermediate(checkpoint.intermediate, checkpoint.watermark, uncovered);
  }

  /**
   * Fold the complete stream (archives included) and, when `write` is set,
   * persist a fresh checkpoint covering it. This is the one-time migration
   * cost and the safety valve for reordered or re-synced events.
   */
  private async rebuildViewWithoutShardLock(write: boolean): Promise<LedgerView> {
    const events = await this.loadEventsWithoutShardLock();
    const intermediate = foldIntermediate(events, { conflict: this.opts.conflict });
    let watermark = 0;
    for (const event of events) watermark = Math.max(watermark, event.lamport);
    if (write) {
      const covered = new Map(events.map((event) => [event.id, eventDigest(event)] as const));
      await this.writeCheckpointWithoutLock(intermediate, covered, watermark, Date.now());
    }
    return viewFromIntermediate(intermediate, watermark, events);
  }

  async loadSnapshot(): Promise<{ events: IrEvent[]; state: LogState }> {
    const view = await this.loadView();
    return { events: view.recentEvents, state: view.state };
  }

  /** Highest lamport in the checkpoint + live shards, plus one. */
  async nextLamport(): Promise<number> {
    await this.awaitReady();
    return this.withShardAccess(async () => {
      if ((await this.readMetaForLoad()).reset) return 1;
      const checkpoint = await this.readCheckpointWithoutLock();
      let max = checkpoint?.watermark ?? 0;
      try {
        const events = await this.collectEventsWithoutShardLock(false, {
          skipMigrationLog: checkpoint !== null,
        });
        for (const event of events) if (event.lamport > max) max = event.lamport;
      } catch {
        const events = await this.loadEventsWithoutShardLock();
        for (const event of events) if (event.lamport > max) max = event.lamport;
      }
      return max + 1;
    });
  }

  /**
   * Build a fold checkpoint once, when the ledger has enough history to make
   * the read worth pruning.
   *
   * Compaction is shard-only by design, so it never sees a migrated
   * collection's history (that lives in the migration log). This is the path
   * that gives those vaults a checkpoint at all. One attempt per session: a
   * failed write must not loop on every load.
   */
  async ensureCheckpoint(now: number): Promise<{ built: boolean; events: number }> {
    await this.awaitReady();
    return this.withShardAccess(async () => {
      if (this.checkpointAttempted) return { built: false, events: 0 };
      this.checkpointAttempted = true;
      if ((await this.readMetaForLoad()).reset) return { built: false, events: 0 };
      if (await this.readCheckpointWithoutLock()) return { built: false, events: 0 };
      const events = await this.loadEventsWithoutShardLock();
      if (events.length < CHECKPOINT_MIN_EVENTS) {
        return { built: false, events: events.length };
      }
      const intermediate = foldIntermediate(events, { conflict: this.opts.conflict });
      const covered = new Map(events.map((event) => [event.id, eventDigest(event)] as const));
      let watermark = 0;
      for (const event of events) watermark = Math.max(watermark, event.lamport);
      await this.writeCheckpointWithoutLock(intermediate, covered, watermark, now);
      return { built: true, events: events.length };
    });
  }

  async compactLocalShard(
    now: number,
    policy?: { maxEvents?: number; maxAgeDays?: number },
  ): Promise<{ compacted: boolean; archived: number; dropped: number }> {
    await this.awaitReady();
    return this.withShardAccess(() => this.compactLocalShardWithoutShardLock(now, policy));
  }

  private async compactLocalShardWithoutShardLock(
    now: number,
    policy?: { maxEvents?: number; maxAgeDays?: number },
  ): Promise<{ compacted: boolean; archived: number; dropped: number }> {
    const maxEvents = policy?.maxEvents ?? 250;
    const maxAgeDays = policy?.maxAgeDays ?? 7;
    const dayMs = 86400000;

    const deviceId = await this.getDeviceId();
    const paths = await this.paths();
    const shardPath = `${paths.logDir}/${deviceId}.jsonl`;

    let localEvents: IrEvent[] = [];
    if (await this.fs.exists(shardPath)) {
      const content = await this.fs.read(shardPath);
      localEvents = this.parseJsonl(shardPath, content);
    }

    const ageCutoff = now - maxAgeDays * dayMs;
    const oldestTs =
      localEvents.length === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...localEvents.map((e) => e.ts));

    if (localEvents.length <= maxEvents && oldestTs >= ageCutoff) {
      return { compacted: false, archived: 0, dropped: 0 };
    }

    const undoable = findLastUndoableGrade(localEvents);
    const result = compact(localEvents, now, {
      maxEvents,
      maxAgeDays,
      mustKeep: undoable ? [undoable] : [],
    });

    const compactedAway = [...result.archived, ...result.dropped];
    const transactionId = localEvents.map((event) => event.id).sort().join("_");
    const archivePath = `${paths.compactionDir}/${deviceId}-${hashString(transactionId)}.jsonl`;
    const archiveBody = localEvents.map((e) => JSON.stringify(e) + "\n").join("");
    await this.fs.write(archivePath, archiveBody);
    const verifiedArchive = this.parseJsonl(archivePath, await this.fs.read(archivePath));
    assertSameEvents("IrLedger.compactLocalShard archive", localEvents, verifiedArchive);

    const rhistPath = `${paths.reviewHistoryDir}/${deviceId}.jsonl`;
    if (result.archived.length > 0) {
      const existing = await this.fs.exists(rhistPath)
        ? this.parseJsonl(rhistPath, await this.fs.read(rhistPath))
        : [];
      const existingIds = new Set(existing.map((event) => event.id));
      const historyBody = [...existing, ...result.archived.filter((event) => !existingIds.has(event.id))]
        .map((event) => JSON.stringify(event) + "\n").join("");
      await this.fs.write(rhistPath, historyBody);
      this.parseJsonl(rhistPath, await this.fs.read(rhistPath));
    }

    // Fold the compacted-away events into this device's checkpoint, so the
    // next load does not have to re-read the transaction archive.
    const checkpoint = await this.readCheckpointWithoutLock();
    if (!checkpoint) {
      // First checkpoint: cover the complete stream once, not just this
      // shard, so a later foreign shard cannot sit below the watermark.
      const all = await this.loadEventsWithoutShardLock();
      const intermediate = foldIntermediate(all, { conflict: this.opts.conflict });
      const covered = new Map(all.map((event) => [event.id, eventDigest(event)] as const));
      let watermark = 0;
      for (const event of all) watermark = Math.max(watermark, event.lamport);
      await this.writeCheckpointWithoutLock(intermediate, covered, watermark, now);
    } else {
      const newly = compactedAway.filter((event) => !checkpoint.covered.has(event.id));
      if (newly.length > 0) {
        let minLamport = Number.POSITIVE_INFINITY;
        let watermark = checkpoint.watermark;
        for (const event of newly) {
          minLamport = Math.min(minLamport, event.lamport);
          watermark = Math.max(watermark, event.lamport);
        }
        // Only extend a lamport prefix. Otherwise leave the checkpoint alone
        // and let the next load rebuild from the full stream.
        if (minLamport > checkpoint.watermark) {
          foldFrom(checkpoint.intermediate, newly, { conflict: this.opts.conflict });
          const covered = new Map(checkpoint.covered);
          for (const event of newly) covered.set(event.id, eventDigest(event));
          await this.writeCheckpointWithoutLock(checkpoint.intermediate, covered, watermark, now);
        }
      }
    }

    const shardBody = result.keep.map((e) => JSON.stringify(e) + "\n").join("");
    await this.fs.write(shardPath, shardBody);

    return {
      compacted: true,
      archived: result.archived.length,
      dropped: result.dropped.length,
    };
  }

  async loadBookmarks(): Promise<BookmarkMap> {
    const { bookmarks } = await this.paths();
    if (!(await this.fs.exists(bookmarks))) return {};
    try {
      const raw = await this.fs.read(bookmarks);
      return JSON.parse(raw) as BookmarkMap;
    } catch {
      return {};
    }
  }

  async saveBookmarks(bm: BookmarkMap): Promise<void> {
    await this.awaitReady();
    const data = deterministicJsonStringify(bm);
    const { bookmarks } = await this.paths();
    await this.fs.write(bookmarks, data);
  }

  async loadSessionSnapshot(): Promise<SessionSnapshot | null> {
    if (!(await this.fs.exists(SESSION))) return null;
    try {
      return parseSessionSnapshot(JSON.parse(await this.fs.read(SESSION)));
    } catch {
      return null;
    }
  }

  async saveSessionSnapshot(snapshot: SessionSnapshot): Promise<void> {
    await this.awaitReady();
    const validated = parseSessionSnapshot(snapshot);
    if (!validated) throw new Error("IrLedger.saveSessionSnapshot: invalid snapshot");
    await this.fs.write(SESSION, deterministicJsonStringify(validated));
  }

  async clearSessionSnapshot(): Promise<void> {
    if (this.fs.remove && await this.fs.exists(SESSION)) await this.fs.remove(SESSION);
  }

  async loadAutoPostponeMarker(): Promise<{ dayKey: string; batchId: string } | null> {
    if (!(await this.fs.exists(AUTO_POSTPONE))) return null;
    try {
      const value = JSON.parse(await this.fs.read(AUTO_POSTPONE)) as Record<string, unknown>;
      return typeof value.dayKey === "string" && typeof value.batchId === "string"
        ? { dayKey: value.dayKey, batchId: value.batchId } : null;
    } catch {
      return null;
    }
  }

  async saveAutoPostponeMarker(marker: { dayKey: string; batchId: string }): Promise<void> {
    await this.awaitReady();
    await this.fs.write(AUTO_POSTPONE, deterministicJsonStringify(marker));
  }

  async loadDailyAnalytics(deviceId: DeviceId, dayKey: string): Promise<DailyPriorityAnalytics | null> {
    const path = `${ANALYTICS_DIR}/${deviceId}/${dayKey}.json`;
    if (!(await this.fs.exists(path))) return null;
    try {
      return parseDailyPriorityAnalytics(JSON.parse(await this.fs.read(path)));
    } catch {
      return null;
    }
  }

  async saveDailyAnalytics(day: DailyPriorityAnalytics): Promise<void> {
    await this.awaitReady();
    const parsed = parseDailyPriorityAnalytics(day);
    if (!parsed) throw new Error("IrLedger.saveDailyAnalytics: invalid analytics");
    await this.fs.write(`${ANALYTICS_DIR}/${day.deviceId}/${day.dayKey}.json`,
      deterministicJsonStringify(parsed));
  }

  async reconcile(): Promise<LogState> {
    const rm = this.fs.remove;
    if (!rm) {
      throw new Error("IrLedger.reconcile requires VaultFs.remove");
    }

    const state = await this.load();

    // Per-element write failures are isolated. The most common cause in
    // practice is `elementIdForPath` producing a hex-encoded filename that
    // blows past the filesystem's 255-byte limit for deeply nested notes —
    // crashing the loop would take every subsequent extract command down
    // with it. State files are a derived cache, not the source of truth;
    // the event log is. A missing state file is invisible to the running
    // plugin (the fold reads events, not state), so logging + continuing
    // is safe.
    for (const [, element] of state.elements) {
      const path = elementStatePath(element.id);
      const data = deterministicJsonStringify(element);
      try {
        if (await this.fs.exists(path)) {
          const cur = await this.fs.read(path);
          if (cur === data) {
            continue;
          }
        }
        await this.fs.write(path, data);
      } catch (e) {
        if (!this.writeFailureLogged.has(element.id)) {
          this.writeFailureLogged.add(element.id);
          console.warn(
            `Incremental Reading: skipping state file write for ${element.id}: ${(e as Error)?.message ?? e}`,
          );
        }
      }
    }

    if (state.tombstones.size > 0) {
      const tombObj: Record<string, unknown> = {};
      for (const path of [...state.tombstones.keys()].sort()) {
        const t = state.tombstones.get(path);
        if (t !== undefined) {
          tombObj[path] = t;
        }
      }
      const tombBytes = deterministicJsonStringify(tombObj);
      if (await this.fs.exists(TOMBSTONES)) {
        const cur = await this.fs.read(TOMBSTONES);
        if (cur !== tombBytes) {
          await this.fs.write(TOMBSTONES, tombBytes);
        }
      } else {
        await this.fs.write(TOMBSTONES, tombBytes);
      }
    } else if (await this.fs.exists(TOMBSTONES)) {
      await rm(TOMBSTONES);
    }

    const listed = await this.fs.list(STATEDIR);
    for (const fullPath of listed) {
      const id = parseElementStateId(fullPath);
      if (id === null) {
        continue;
      }
      if (!state.elements.has(id) && (await this.fs.exists(fullPath))) {
        await rm(fullPath);
      }
    }

    return state;
  }
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
