/**
 * The store module.
 *
 * This module implements the append-only event log store with persistence
 * through the injected VaultFs interface. It provides methods for initializing
 * the store, managing device IDs, appending events, and loading the current
 * state of the log.
 *
 * No Obsidian API, no node fs/path, all IO via the injected VaultFs.
 */

import { fold, compact, type LogState } from "./log";
import { newDeviceId, type DeviceId, type ElementId } from "./ids";
import type { IrEvent } from "./model";
import type { BookmarkMap } from "./bookmark";

// Fixed paths (constants in the module)
export const META = ".ir/meta.json";
export const DEVICE = ".ir/device.json";
export const LOGDIR = ".ir/log";
export const SNAPSHOT = ".ir/snapshot.jsonl";
export const RHISTDIR = ".ir/review-history";
export const STATEDIR = ".ir/state";
export const TOMBSTONES = ".ir/tombstones.json";
export const BOOKMARKS = ".ir/bookmarks.json";

export interface VaultFs {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  /** Whole-file delete; required when calling {@link IrStore.reconcile}. */
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

export class IrStore {
  private fs: VaultFs;
  private opts: StoreOptions;
  private deviceId?: DeviceId;
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

  async init(): Promise<void> {
    // Initialize META if it doesn't exist
    if (!(await this.fs.exists(META))) {
      await this.fs.write(META, JSON.stringify({ schemaVersion: 1 }));
    }

    // Initialize DEVICE if it doesn't exist
    if (!(await this.fs.exists(DEVICE))) {
      const id = newDeviceId();
      await this.fs.write(DEVICE, JSON.stringify({ deviceId: id }));
      this.deviceId = id;
    }
  }

  async getDeviceId(): Promise<DeviceId> {
    if (this.deviceId) {
      return this.deviceId;
    }

    const deviceContent = await this.fs.read(DEVICE);
    const deviceData = JSON.parse(deviceContent);
    this.deviceId = deviceData.deviceId as DeviceId;
    return this.deviceId;
  }

  async schemaVersion(): Promise<number> {
    const metaContent = await this.fs.read(META);
    const metaData = JSON.parse(metaContent);
    return metaData.schemaVersion as number;
  }

  async appendEvent(ev: IrEvent): Promise<void> {
    const deviceId = await this.getDeviceId();
    const shardPath = `${LOGDIR}/${deviceId}.jsonl`;
    const eventString = JSON.stringify(ev) + "\n";
    await this.fs.append(shardPath, eventString);
  }

  private parseJsonl(content: string): IrEvent[] {
    const out: IrEvent[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        try {
          const event = JSON.parse(trimmedLine);
          out.push(event);
        } catch {
          // Skip malformed lines
          continue;
        }
      }
    }
    return out;
  }

  /**
   * Read all events from the snapshot + every device shard. Same scan
   * `load()` performs; exposed so callers that need the raw stream (stats,
   * deletion args, history exports) don't have to reach into private state.
   */
  async loadEvents(): Promise<IrEvent[]> {
    const events: IrEvent[] = [];

    if (await this.fs.exists(SNAPSHOT)) {
      try {
        const snapContent = await this.fs.read(SNAPSHOT);
        events.push(...this.parseJsonl(snapContent));
      } catch {
        // Skip if snapshot cannot be read
      }
    }

    const shards = await this.fs.list(LOGDIR);

    for (const shard of shards) {
      try {
        const content = await this.fs.read(shard);
        events.push(...this.parseJsonl(content));
      } catch {
        // Skip if shard doesn't exist or can't be read
        continue;
      }
    }

    return events;
  }

  async load(): Promise<LogState> {
    const events = await this.loadEvents();
    return fold(events, { conflict: this.opts.conflict });
  }

  async compactLocalShard(
    now: number,
    policy?: { maxEvents?: number; maxAgeDays?: number },
  ): Promise<{ compacted: boolean; archived: number; dropped: number }> {
    const maxEvents = policy?.maxEvents ?? 250;
    const maxAgeDays = policy?.maxAgeDays ?? 7;
    const dayMs = 86400000;

    const deviceId = await this.getDeviceId();
    const shardPath = `${LOGDIR}/${deviceId}.jsonl`;

    let localEvents: IrEvent[] = [];
    if (await this.fs.exists(shardPath)) {
      try {
        const content = await this.fs.read(shardPath);
        localEvents = this.parseJsonl(content);
      } catch {
        localEvents = [];
      }
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

    const shardBody = result.keep.map((e) => JSON.stringify(e) + "\n").join("");
    await this.fs.write(shardPath, shardBody);

    const compactedAway = [...result.archived, ...result.dropped];
    for (const ev of compactedAway) {
      await this.fs.append(SNAPSHOT, JSON.stringify(ev) + "\n");
    }

    const rhistPath = `${RHISTDIR}/${deviceId}.jsonl`;
    for (const ev of result.archived) {
      await this.fs.append(rhistPath, JSON.stringify(ev) + "\n");
    }

    return {
      compacted: true,
      archived: result.archived.length,
      dropped: result.dropped.length,
    };
  }

  async loadBookmarks(): Promise<BookmarkMap> {
    if (!(await this.fs.exists(BOOKMARKS))) return {};
    try {
      const raw = await this.fs.read(BOOKMARKS);
      return JSON.parse(raw) as BookmarkMap;
    } catch {
      return {};
    }
  }

  async saveBookmarks(bm: BookmarkMap): Promise<void> {
    const data = deterministicJsonStringify(bm);
    await this.fs.write(BOOKMARKS, data);
  }

  async reconcile(): Promise<LogState> {
    const rm = this.fs.remove;
    if (!rm) {
      throw new Error("IrStore.reconcile requires VaultFs.remove");
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
