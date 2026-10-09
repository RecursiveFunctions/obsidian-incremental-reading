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

import { fold, compact, type LogState } from "./log";
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
  bookmarks: string;
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
    return this.withShardAccess(async () => {
      const existing = await this.loadEventsWithoutShardLock();
      assertNoConflictingEvents("IrLedger.appendEvents", existing, events);
      const existingById = new Map(existing.map((event) => [
        event.id,
        deterministicJsonStringify(event),
      ]));
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

  private async loadEventsWithoutShardLock(): Promise<IrEvent[]> {
    if (await this.fs.exists(META)) {
      const meta = this.parseMeta(await this.fs.read(META));
      this.generation = meta.generation;
      if (meta.reset === "inert") return [];
    }
    const paths = this.pathsFor();
    const events: IrEvent[] = [];

    if (await this.fs.exists(paths.snapshot)) {
      const snapContent = await this.fs.read(paths.snapshot);
      events.push(...this.parseJsonl(paths.snapshot, snapContent));
    }

    const archiveEntries: Array<{ path: string; events: IrEvent[] }> = [];
    for (const archive of await this.fs.list(paths.compactionDir)) {
      const archiveEvents = this.parseJsonl(archive, await this.fs.read(archive));
      archiveEntries.push({ path: archive, events: archiveEvents });
      events.push(...archiveEvents);
    }

    const shards = await this.fs.list(paths.logDir);
    for (const shard of shards) {
      const content = await this.fs.read(shard);
      try {
        events.push(...this.parseJsonl(shard, content));
      } catch (error) {
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

  async load(): Promise<LogState> {
    const events = await this.loadEvents();
    return fold(events, { conflict: this.opts.conflict });
  }

  async loadSnapshot(): Promise<{ events: IrEvent[]; state: LogState }> {
    const events = await this.loadEvents();
    return { events, state: fold(events, { conflict: this.opts.conflict }) };
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

    const result = compact(localEvents, now, { maxEvents, maxAgeDays });

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
