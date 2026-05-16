/**
 * Plugin settings + settings tab. Kept minimal for the MVP — only what the
 * Topic-mark feature actually needs — but structured so later features add
 * fields here rather than inventing their own storage.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type IncrementalReadingPlugin from "../main";
import { PRIORITY_MAX, PRIORITY_MIN } from "./types";

export interface IrSettings {
  /** Priority assigned to a note when it's first marked as a topic. */
  defaultPriority: number;
}

export const DEFAULT_SETTINGS: IrSettings = {
  defaultPriority: 33,
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
        `Priority (${PRIORITY_MIN}–${PRIORITY_MAX}, lower = more important) ` +
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
  }
}
