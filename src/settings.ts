/**
 * Plugin settings + settings tab. Kept minimal for the MVP: only what the
 * topic-mark feature needs, but structured so later features add fields
 * here rather than inventing their own storage.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type IncrementalReadingPlugin from "../main";
import { PRIORITY_MAX, PRIORITY_MIN } from "./ir/model";

export interface IrSettings {
  /** Priority assigned to a note when it's first marked as a topic. */
  defaultPriority: number;
  /** Folder new extracts go in. Empty means beside their source note. */
  extractFolder: string;
  /** Review items between each reading element in a session. 0 disables. */
  reviewsPerReading: number;
  /** Days until a topic's first scheduled reread (SM first interval). */
  topicFirstInterval: number;
  /** Default interval multiplier (A-Factor) seeded onto new topics. */
  topicAFactor: number;
  /** Hard cap on a topic's interval in days. */
  topicMaxInterval: number;
  /** Anki deck name written into the TSV header on export. */
  ankiDeckName: string;
  /** Daily ceiling on due elements before mercy starts postponing. */
  mercyCeiling: number;
  /** Priority strictly below which mercy never postpones. */
  mercyPriorityCutoff: number;
  /**
   * When you run Extract or Cloze on a plain markdown note (not yet an IR
   * element), mark it as a topic automatically instead of refusing. Off
   * brings back the explicit "Mark as IR topic first" prompt.
   */
  autoMarkSourceAsTopic: boolean;
  /**
   * SuperMemo "interwoven learning": within a priority band, shuffle the
   * order of due items so positional memory doesn't leak into recall. Seed
   * is the calendar day, so resuming a session mid-day keeps the same
   * order; a new day produces a fresh permutation. Off restores the
   * pre-feature deterministic order (priority, then due time).
   */
  interleaveSimilarPriority: boolean;
}

export const DEFAULT_SETTINGS: IrSettings = {
  defaultPriority: 33,
  extractFolder: "",
  reviewsPerReading: 3,
  topicFirstInterval: 1,
  topicAFactor: 2,
  topicMaxInterval: 1825,
  ankiDeckName: "IR",
  mercyCeiling: 40,
  mercyPriorityCutoff: 10,
  autoMarkSourceAsTopic: true,
  interleaveSimilarPriority: true,
};

export class IrSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: IncrementalReadingPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default topic priority")
      .setDesc(
        `Priority (${PRIORITY_MIN}-${PRIORITY_MAX}, lower = more important) ` +
          "given to a note when you first mark it as a topic.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(PRIORITY_MIN, PRIORITY_MAX, 1)
          .setValue(this.plugin.settings.defaultPriority)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.defaultPriority = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Generated notes folder")
      .setDesc(
        "Vault-relative folder for new extracts and cloze items. Leave " +
          "empty to create each note beside its source.",
      )
      .addText((text) =>
        text
          .setPlaceholder("(beside source)")
          .setValue(this.plugin.settings.extractFolder)
          .onChange(async (value) => {
            this.plugin.settings.extractFolder = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Auto-mark source as topic")
      .setDesc(
        "When you run Extract or Cloze on a plain markdown note (not yet " +
          "an IR element), mark it as a topic automatically. Off restores " +
          "the explicit 'Mark as IR topic first' prompt.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoMarkSourceAsTopic)
          .onChange(async (value) => {
            this.plugin.settings.autoMarkSourceAsTopic = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Reviews per reading")
      .setDesc(
        "How many review items to show between each reading element in a " +
          "session. Set to 0 to review items only.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 10, 1)
          .setValue(this.plugin.settings.reviewsPerReading)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.reviewsPerReading = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Interleave items of similar priority")
      .setDesc(
        "SuperMemo-style: within an equal-priority band, shuffle the order " +
          "so positional memory doesn't help you recall. Seeded by the " +
          "calendar day, so a paused session keeps its order when you " +
          "resume the same day. Off restores priority + due-time order.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.interleaveSimilarPriority)
          .onChange(async (value) => {
            this.plugin.settings.interleaveSimilarPriority = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Topic scheduling" });

    new Setting(containerEl)
      .setName("First interval (days)")
      .setDesc(
        "Days until a topic is due again after you first press Next. " +
          "Later intervals grow from this by the A-Factor.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(this.plugin.settings.topicFirstInterval)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.topicFirstInterval = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default A-Factor")
      .setDesc(
        "Interval multiplier seeded on new topics. Each Next multiplies " +
          "the interval by this. SuperMemo-style; higher spreads reading " +
          "further apart. Editable per note via the ir-a-factor key.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1.2, 4, 0.1)
          .setValue(this.plugin.settings.topicAFactor)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.topicAFactor = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Max interval (days)")
      .setDesc("Hard cap so a topic interval can't run away.")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.topicMaxInterval))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 1) {
              this.plugin.settings.topicMaxInterval = Math.round(n);
              await this.plugin.saveSettings();
            }
          }),
      );

    containerEl.createEl("h3", { text: "Mercy / postpone" });

    new Setting(containerEl)
      .setName("Daily ceiling")
      .setDesc(
        "Maximum due elements per day. Running mercy postpones the lowest-" +
          "priority overflow until tomorrow, preserving scheduler state.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(5, 200, 5)
          .setValue(this.plugin.settings.mercyCeiling)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.mercyCeiling = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Priority cutoff")
      .setDesc(
        `Elements with priority strictly below this (${PRIORITY_MIN} = most ` +
          "important) are never postponed by mercy, no matter the overflow.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(PRIORITY_MIN, PRIORITY_MAX, 1)
          .setValue(this.plugin.settings.mercyPriorityCutoff)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.mercyPriorityCutoff = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Anki export" });

    new Setting(containerEl)
      .setName("Deck name")
      .setDesc(
        "Deck written into the TSV header. Anki imports into this deck " +
          "(creating it if needed). Existing items re-import in place via " +
          "their stable IR id, so safe to run repeatedly.",
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.ankiDeckName)
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (trimmed) {
              this.plugin.settings.ankiDeckName = trimmed;
              await this.plugin.saveSettings();
            }
          }),
      );

    containerEl.createEl("h3", { text: "Danger zone" });

    new Setting(containerEl)
      .setName("Nuke all IR data")
      .setDesc(
        "Send every note marked as an IR topic, extract, or cloze item to " +
          "your vault trash, and delete the hidden .ir/ state folder " +
          "(event log, schedule, bookmarks, tombstones). The per-note " +
          "auto-promote handler is suppressed during the sweep so it " +
          'does not spawn replacement "orphan-…" notes. Use this when ' +
          "you want a clean slate; confirmation is required.",
      )
      .addButton((b) =>
        b
          .setButtonText("Nuke everything")
          .setWarning()
          .onClick(() => void this.plugin.runNuke()),
      );
  }
}
