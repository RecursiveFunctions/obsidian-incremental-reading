/**
 * Plugin settings + settings tab. Kept minimal for the MVP: only what the
 * topic-mark feature needs, but structured so later features add fields
 * here rather than inventing their own storage.
 */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type IncrementalReadingPlugin from "../main";
import { PRIORITY_MAX, PRIORITY_MIN } from "./ir/model";
import { cloneDefaultSettings } from "./ir/settings-data";
import { getSm20MatrixStats } from "./ir/sm20-matrix";
import {
  sliderToRepSortFactor,
  simulateRepSortPositionCurve,
} from "./sm18-ir-mechanics";
import {
  isSpaceAfterReveal,
  SPACE_AFTER_REVEAL_OPTIONS,
} from "./ir/review-keys";
import { formatReviewsPerReadingSummary } from "./ir/stats-presenter";
import { resolveUnifiedMobileHubEnabled } from "./ir/viewport-tiers";

export type { IrSettings } from "./ir/settings-data";
export { cloneDefaultSettings, DEFAULT_SETTINGS } from "./ir/settings-data";

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
      .setName("Restore defaults")
      .setDesc(
        "Put every slider, toggle, and text field on this page back to " +
          "the values a new vault gets. Does not touch your notes or " +
          "review history.",
      )
      .addButton((b) =>
        b.setButtonText("Restore defaults").onClick(() => {
          void this.restoreDefaults();
        }),
      );

    containerEl.createEl("h3", { text: "Review" });

    new Setting(containerEl)
      .setName("Primary item scheduler")
      .setDesc(
        "SM-20 uses SuperMemo 20's analytical SInc surface. FSRS-6 uses ts-fsrs. Calibrate FSRS weights and inspect forgetting index curves in IR stats.",
      )
      .addButton((btn) =>
        btn
          .setButtonText("Models & FI in IR stats")
          .onClick(() => {
            void this.plugin.openStatsView("models");
          }),
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sm20", "SM-20 (analytical SInc)")
          .addOption("fsrs", "FSRS-6")
          .setValue(this.plugin.settings.primaryScheduler)
          .onChange(async (value) => {
            this.plugin.settings.primaryScheduler = value === "fsrs" ? "fsrs" : "sm20";
            this.plugin.settings.notices.sm20SchedulerOffer = true;
            await this.plugin.saveSettings();
            this.plugin.refreshSchedulerViews();
          }),
      );

    const mixSummary = formatReviewsPerReadingSummary(
      this.plugin.settings.reviewsPerReading,
      this.plugin.settings.sortingPolicy,
    );
    const mixSetting = new Setting(containerEl)
      .setName("Reviews per reading")
      .setDesc(mixSummary.description);
    mixSetting.addSlider((slider) =>
      slider
        .setLimits(0, 10, 1)
        .setValue(this.plugin.settings.reviewsPerReading)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.reviewsPerReading = value;
          this.plugin.settings.sortingPolicy.readingProportion =
            value <= 0 ? 0 : 1 / (value + 1);
          mixSetting.setDesc(
            formatReviewsPerReadingSummary(value, this.plugin.settings.sortingPolicy)
              .description,
          );
          await this.plugin.saveSettings();
        }),
    );

    new Setting(containerEl)
      .setName("Final Drill")
      .setDesc(
        "Re-test weak recall items at the end of today's session without creating new ledger grades or altering long-term intervals.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("again-and-hard", "Again & Hard (< Good, SM-20 default)")
          .addOption("again", "Again only")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.finalDrillMode)
          .onChange(async (value) => {
            this.plugin.settings.finalDrillMode =
              value === "again" || value === "off" ? value : "again-and-hard";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Space after cloze reveal")
      .setDesc(
        "After Space shows the answer, a second Space grades this rating " +
          "(Anki/SuperMemo muscle memory). First Space still reveals. " +
          "Reading cards keep Space as Next. Off leaves Space as reveal-only.",
      )
      .addDropdown((dropdown) => {
        for (const opt of SPACE_AFTER_REVEAL_OPTIONS) {
          dropdown.addOption(opt.value, opt.label);
        }
        const current = this.plugin.settings.spaceAfterReveal;
        dropdown.setValue(isSpaceAfterReveal(current) ? current : "good");
        dropdown.onChange(async (value) => {
          if (!isSpaceAfterReveal(value)) return;
          this.plugin.settings.spaceAfterReveal = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Priority queue preset")
      .setDesc(
        "Strict follows global priority. Balanced and Discovery add deterministic, day-seeded variety without changing stored priorities.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("strict", "Strict priority")
          .addOption("balanced", "Balanced")
          .addOption("discovery", "Discovery")
          .addOption("custom", "Custom")
          .setValue(this.plugin.settings.sortingPolicy.preset)
          .onChange(async (value) => {
            const policy = this.plugin.settings.sortingPolicy;
            policy.preset =
              value === "strict" || value === "discovery" || value === "custom"
                ? value
                : "balanced";
            if (policy.preset === "strict") {
              policy.traversal = "priority";
              policy.itemJitter = 0;
              policy.readingJitter = 0;
            } else if (policy.preset === "balanced") {
              policy.traversal = "mixed";
              policy.readingProportion = 0.25;
              this.plugin.settings.reviewsPerReading = 3;
              policy.itemJitter = 0.2;
              policy.readingJitter = 0.3;
            } else if (policy.preset === "discovery") {
              policy.traversal = "mixed";
              policy.readingProportion = 0.4;
              this.plugin.settings.reviewsPerReading = Math.round((1 - 0.4) / 0.4);
              policy.itemJitter = 0.75;
              policy.readingJitter = 1;
            }
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    const advReview = containerEl.createEl("details", {
      cls: "ir-settings-advanced",
    });
    if (this.plugin.settings.sortingPolicy.preset === "custom") {
      advReview.open = true;
    }
    advReview.createEl("summary", {
      cls: "ir-settings-advanced-summary",
      text: "Advanced scheduling & SM-20",
    });
    const advBody = advReview.createDiv({ cls: "ir-settings-advanced-body" });

    const matrix = this.plugin.getSm20Matrix();
    const matrixStats = matrix ? getSm20MatrixStats(matrix) : null;
    const obsSummary = matrixStats
      ? `Learned observations: ${matrixStats.totalSincCases} SInc, ${matrixStats.totalRecallCases} Recall`
      : "Learned observations: not yet loaded";
    new Setting(advBody)
      .setName("SM-20 optimization matrix")
      .setDesc(obsSummary)
      .addButton((btn) =>
        btn
          .setButtonText("Rebuild SM-20 matrix from history")
          .onClick(async () => {
            await this.plugin.rebuildSm20MatrixFromHistory(true);
            this.display();
          }),
      );

    new Setting(advBody)
      .setName("Randomize Final Drill")
      .setDesc("Shuffle items when entering Final Drill instead of keeping first-seen order.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.randomizeDrill)
          .onChange(async (value) => {
            this.plugin.settings.randomizeDrill = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(advBody)
      .setName("Interleave items of similar priority")
      .setDesc(
        "For imported or malformed tied priorities, shuffle the tied order " +
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

    if (this.plugin.settings.sortingPolicy.preset === "custom") {
      for (const [key, name, description] of [
        ["readingProportion", "Custom reading proportion", "Fine-grained share of mixed sessions reserved for topics and extracts."],
        ["itemJitter", "Item randomization", "Bounded deterministic SM-20 rank dispersion for recall items."],
        ["readingJitter", "Reading randomization", "Bounded deterministic SM-20 rank dispersion for topics and extracts."],
      ] as const) {
        let previewHost: HTMLElement | null = null;
        const setting = new Setting(advBody).setName(name).setDesc(description);
        if (key === "itemJitter" || key === "readingJitter") {
          previewHost = setting.controlEl.createDiv({ cls: "ir-repsort-preview" });
          this.renderRepSortCurvePreview(previewHost, this.plugin.settings.sortingPolicy[key]);
        }
        setting.addSlider((slider) =>
          slider
            .setLimits(0, 1, 0.05)
            .setValue(this.plugin.settings.sortingPolicy[key])
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.sortingPolicy[key] = value;
              if (key === "readingProportion") {
                this.plugin.settings.reviewsPerReading =
                  value <= 0 ? 0 : Math.min(10, Math.max(0, Math.round((1 - value) / value)));
                mixSetting.setDesc(
                  formatReviewsPerReadingSummary(
                    this.plugin.settings.reviewsPerReading,
                    this.plugin.settings.sortingPolicy,
                  ).description,
                );
              }
              if (previewHost) {
                this.renderRepSortCurvePreview(previewHost, value);
              }
              this.plugin.settings.sortingPolicy.preset = "custom";
              await this.plugin.saveSettings();
            }),
        );
      }
    }

    new Setting(advBody)
      .setName("Show scheduler divergence picker")
      .setDesc(
        "Off (default for new vaults): grades follow your primary scheduler with no extra " +
          "prompt. On: when SM-20, FSRS-6, DSR, and SM-2 disagree enough on the next " +
          "interval, an inline picker lets you choose.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showDivergencePicker)
          .onChange(async (value) => {
            this.plugin.settings.showDivergencePicker = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(advBody)
      .setName("Neural Queue: lexical & title-mention links")
      .setDesc(
        "Connect unlinked note-title/alias mentions and shared rare terms during Neural Queue spreading activation.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.neuralUseLexicalLinks)
          .onChange(async (value) => {
            this.plugin.settings.neuralUseLexicalLinks = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl("h3", { text: "Extracts" });

    new Setting(containerEl)
      .setName("Extract to standalone note")
      .setDesc(
        "Glossary: an anchored extract stays in the source (highlight only, " +
          "no new file). A standalone note is a new markdown file. Off " +
          "(default) creates anchored extracts. On: each extract becomes a " +
          "standalone note in the folder below and inherits the parent's " +
          "tags, aliases, and source/url. Cloze items already create notes " +
          "either way. Promote (Alt+Shift+P) turns an anchored extract into " +
          "a standalone note later.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.extractCreatesStandaloneNote)
          .onChange(async (value) => {
            this.plugin.settings.extractCreatesStandaloneNote = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Image occlusion default mode")
      .setDesc(
        "Hide all, guess one: every mask stays covered and one is tested. " +
          "Hide one: only the tested mask is covered; the rest show as context.",
      )
      .addDropdown((dd) =>
        dd
          .addOption("hide-all", "Hide all, guess one")
          .addOption("hide-one", "Hide one, show rest")
          .setValue(this.plugin.settings.occlusionDefaultMode)
          .onChange(async (value) => {
            this.plugin.settings.occlusionDefaultMode =
              value === "hide-one" ? "hide-one" : "hide-all";
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
      .setName("When a source note is deleted")
      .setDesc(
        "Highlights from that note can become their own files, or stay as " +
          "in review with no new file. You still get a choice each time; " +
          "this chooses the emphasized button. On (default): make " +
          "them notes. Off: keep without notes.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.makeNotesWhenSourceDeleted)
          .onChange(async (value) => {
            this.plugin.settings.makeNotesWhenSourceDeleted = value;
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

    containerEl.createEl("h3", { text: "Topics" });

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

    containerEl.createEl("h3", { text: "Overload" });

    new Setting(containerEl)
      .setName("Auto-postpone overdue work")
      .setDesc("Opt in to postponing overflow on startup. Work newly due today is always kept.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoPostponePolicy.enabled)
        .onChange(async (value) => {
          this.plugin.settings.autoPostponePolicy.enabled = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Overdue elements to keep")
      .setDesc("Number of highest-priority overdue elements retained by startup auto-postpone.")
      .addSlider((slider) => slider.setLimits(0, 200, 5)
        .setValue(this.plugin.settings.autoPostponePolicy.keepOverdue)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.autoPostponePolicy.keepOverdue = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("Advanced auto-postpone")
      .setDesc("Scale startup auto-postpone delays by interval, priority, retention, and A-Factor (up to 30 days).")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.autoPostponePolicy.advanced)
        .onChange(async (value) => {
          this.plugin.settings.autoPostponePolicy.advanced = value;
          await this.plugin.saveSettings();
        }));

    containerEl.createEl("h3", { text: "Priority scheduling" });

    new Setting(containerEl)
      .setName("Priority-aware scheduling")
      .setDesc("Apply priority-based retention and A-Factor only to future reviews. Existing due dates are never rewritten.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.prioritySchedulingPolicy.enabled)
        .onChange(async (value) => {
          this.plugin.settings.prioritySchedulingPolicy.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.prioritySchedulingPolicy.enabled) {
      for (const [key, name, min, max, step] of [
        ["itemHighRetention", "High-priority item retention", 0.7, 0.99, 0.01],
        ["itemLowRetention", "Low-priority item retention", 0.7, 0.99, 0.01],
        ["readingHighAFactor", "High-priority reading A-Factor", 1.1, 4, 0.1],
        ["readingLowAFactor", "Low-priority reading A-Factor", 1.1, 4, 0.1],
      ] as const) {
        new Setting(containerEl).setName(name).addSlider((slider) => slider
          .setLimits(min, max, step)
          .setValue(this.plugin.settings.prioritySchedulingPolicy[key])
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.prioritySchedulingPolicy[key] = value;
            await this.plugin.saveSettings();
          }));
      }
    }

    new Setting(containerEl)
      .setName("Daily ceiling")
      .setDesc(
        "Maximum due elements per day. Running mercy postpones the lowest-" +
          "priority overflow across future days with free capacity, preserving scheduler state.",
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
        `Elements with priority at or below this (${PRIORITY_MIN} = most ` +
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

    new Setting(containerEl)
      .setName("Multi-factor Mercy scoring")
      .setDesc(
        "When enabled, Mercy orders due overflow using a 5-dimension " +
          "ordinal formula (Importance, Lateness, Easiness, Investment, Recency) " +
          "instead of flat priority alone.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(((this.plugin.settings.mercyWeights.mode ?? 3) & 1) === 1)
          .onChange(async (value) => {
            this.plugin.settings.mercyWeights.mode = value ? 3 : 0;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (((this.plugin.settings.mercyWeights.mode ?? 3) & 1) === 1) {
      for (const [key, name, desc] of [
        ["importance", "Mercy weight: Importance", "Weight on element priority complement 1 - priority/100 (default: 5)."],
        ["lateness", "Mercy weight: Lateness", "Weight on sigmoid lateness ratio (default: 1)."],
        ["easiness", "Mercy weight: Easiness", "Weight on low lapse count and low overdue ratio (default: 6)."],
        ["investment", "Mercy weight: Investment", "Weight on repetition count and typical interval (default: 10)."],
        ["recency", "Mercy weight: Recency", "Weight on short overdue elapsed time and low lapse count (default: 8)."],
      ] as const) {
        new Setting(containerEl)
          .setName(name)
          .setDesc(desc)
          .addSlider((slider) =>
            slider
              .setLimits(0, 10, 1)
              .setValue(this.plugin.settings.mercyWeights[key])
              .setDynamicTooltip()
              .onChange(async (value) => {
                this.plugin.settings.mercyWeights[key] = value;
                await this.plugin.saveSettings();
              }),
          );
      }
    }

    containerEl.createEl("h3", { text: "Mobile & touch" });

    new Setting(containerEl)
      .setName("Floating IR button & hub")
      .setDesc(
        "Show the due-badged workspace button outside review. Tap to open the Incremental Reading hub; long-press for Quick Capture.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(resolveUnifiedMobileHubEnabled(this.plugin.settings))
          .onChange(async (value) => {
            this.plugin.settings.mobileWorkspaceFab = value;
            this.plugin.settings.mobileCaptureFab = value;
            this.plugin.settings.mobileReviewFab = value;
            this.plugin.settings.mobileShell = value;
            await this.plugin.saveSettings();
            this.plugin.refreshMobileVisibility();
          }),
      );

    new Setting(containerEl)
      .setName("Review layout")
      .setDesc("Full shows the source column; minimal hides it for more card space.")
      .addDropdown((dd) =>
        dd
          .addOption("full", "Full")
          .addOption("minimal", "Minimal")
          .setValue(this.plugin.settings.mobileReviewLayout)
          .onChange(async (value) => {
            this.plugin.settings.mobileReviewLayout = value === "minimal" ? "minimal" : "full";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Review font size")
      .setDesc("Scale factor for card text in mobile review.")
      .addSlider((slider) =>
        slider
          .setLimits(0.75, 1.5, 0.05)
          .setValue(this.plugin.settings.mobileReviewFontSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.mobileReviewFontSize = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Review buttons")
      .setDesc("Comfortable is larger for thumbs; compact saves space.")
      .addDropdown((dd) =>
        dd
          .addOption("comfortable", "Comfortable")
          .addOption("compact", "Compact")
          .setValue(this.plugin.settings.mobileReviewButtons)
          .onChange(async (value) => {
            this.plugin.settings.mobileReviewButtons = value === "compact" ? "compact" : "comfortable";
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
      .setName("Reset IR state (keep notes)")
      .setDesc(
        "Delete the hidden .ir/ folder (event log, schedule, bookmarks, " +
          "tombstones) without touching any notes. Your IR notes keep " +
          "their ir-type: frontmatter but become inert until you re-import " +
          "or strip the keys. Use this when you want a fresh schedule but " +
          "want to keep your notes.",
      )
      .addButton((b) =>
        b
          .setButtonText("Reset state")
          .setWarning()
          .onClick(() => void this.plugin.runResetState()),
      );

    new Setting(containerEl)
      .setName("Nuke everything (delete notes too)")
      .setDesc(
        "Send every markdown note in your vault with ir-type: frontmatter " +
          "to your vault trash — including notes you marked as topics by " +
          "hand, not just plugin-generated ones — and delete the .ir/ " +
          "folder. The confirmation modal shows the full list of paths " +
          "before you commit. Notes are recoverable from your vault " +
          "trash; .ir/ state is not.",
      )
      .addButton((b) =>
        b
          .setButtonText("Nuke everything")
          .setWarning()
          .onClick(() => void this.plugin.runNuke()),
      );
  }

  private renderRepSortCurvePreview(host: HTMLElement, activeStrength: number): void {
    host.empty();
    const clamped = Math.min(1, Math.max(0, Number.isFinite(activeStrength) ? activeStrength : 0));
    const factor = clamped <= 0 ? 0 : sliderToRepSortFactor(clamped * 100);
    const factorLabel =
      clamped <= 0 ? "strict" : factor >= 100 ? "×1000" : `×${factor.toFixed(2)}`;
    const chart = host.createDiv({
      cls: "ir-repsort-bars",
      attr: {
        role: "img",
        "aria-label": `Simulated (position, 100 - priority) dispersion curve at ${factorLabel}`,
        title: `SM-20 (pos, 100 - P) curve · dispersion ${factorLabel}`,
      },
    });
    const curve = simulateRepSortPositionCurve(clamped, 24);
    const width = 96;
    const height = 24;
    const svg = chart.createSvg("svg", {
      cls: "ir-repsort-svg",
      attr: {
        viewBox: `0 0 ${width} ${height}`,
        width: String(width),
        height: String(height),
      },
    });
    svg.createSvg("line", {
      cls: "ir-repsort-svg-baseline",
      attr: {
        x1: "4",
        y1: "3",
        x2: String(width - 4),
        y2: String(height - 3),
      },
    });
    const pts = curve.map((pt) => {
      const x = pt.position * (width - 8) + 4;
      const y = height - 3 - (pt.inversePriority / 100) * (height - 6);
      return { x, y };
    });
    const polyPoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    svg.createSvg("polygon", {
      cls: "ir-repsort-svg-area",
      attr: {
        points: `4,${height - 3} ${polyPoints} ${width - 4},${height - 3}`,
      },
    });
    svg.createSvg("polyline", {
      cls: "ir-repsort-svg-line",
      attr: {
        points: polyPoints,
        fill: "none",
      },
    });
    const activePt = pts[Math.round(clamped * (pts.length - 1))] ?? pts[0]!;
    svg.createSvg("circle", {
      cls: "ir-repsort-svg-dot",
      attr: {
        cx: activePt.x.toFixed(1),
        cy: activePt.y.toFixed(1),
        r: "2.5",
      },
    });
    host.createSpan({ cls: "ir-repsort-readout", text: factorLabel });
  }

  private async restoreDefaults(): Promise<void> {
    this.plugin.settings = cloneDefaultSettings();
    await this.plugin.saveSettings();
    this.display();
    new Notice("Incremental Reading: settings restored to defaults.");
  }
}
