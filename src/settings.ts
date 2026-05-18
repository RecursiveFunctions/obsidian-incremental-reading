/**
 * Plugin settings + settings tab. Kept minimal for the MVP: only what the
 * topic-mark feature needs, but structured so later features add fields
 * here rather than inventing their own storage.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type IncrementalReadingPlugin from "../main";
import { PRIORITY_MAX, PRIORITY_MIN } from "./types";

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
}

export const DEFAULT_SETTINGS: IrSettings = {
  defaultPriority: 33,
  extractFolder: "",
  reviewsPerReading: 3,
  topicFirstInterval: 1,
  topicAFactor: 2,
  topicMaxInterval: 1825,
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
  }
}
