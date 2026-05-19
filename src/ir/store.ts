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
import { newDeviceId, type DeviceId } from "./ids";
import type { IrEvent } from "./model";

// Fixed paths (constants in the module)
export const META = ".ir/meta.json";
export const DEVICE = ".ir/device.json";
export const LOGDIR = ".ir/log";
export const SNAPSHOT = ".ir/snapshot.jsonl";
export const RHISTDIR = ".ir/review-history";

export interface VaultFs {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  append(path: string, data: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

export interface StoreOptions {
  conflict?: "conservative" | "clock-order";
}

export class IrStore {
  private fs: VaultFs;
  private opts: StoreOptions;
  private deviceId?: DeviceId;

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

  async load(): Promise<LogState> {
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
}
