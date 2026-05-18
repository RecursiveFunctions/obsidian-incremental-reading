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

import { fold, type LogState } from "./log";
import { newDeviceId, type DeviceId } from "./ids";
import type { IrEvent } from "./model";

// Fixed paths (constants in the module)
export const META = ".ir/meta.json";
export const DEVICE = ".ir/device.json";
export const LOGDIR = ".ir/log";

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

  async load(): Promise<LogState> {
    const shards = await this.fs.list(LOGDIR);
    const events: IrEvent[] = [];

    for (const shard of shards) {
      try {
        const content = await this.fs.read(shard);
        const lines = content.split("\n");

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine) {
            try {
              const event = JSON.parse(trimmedLine);
              events.push(event);
            } catch (e) {
              // Skip malformed lines
              continue;
            }
          }
        }
      } catch (e) {
        // Skip if shard doesn't exist or can't be read
        continue;
      }
    }

    return fold(events, { conflict: this.opts.conflict });
  }
}