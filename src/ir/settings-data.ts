/**
 * Plugin settings shape and new-vault defaults. Pure: no Obsidian import,
 * so tests can clone defaults without loading the settings tab.
 */

export interface IrSettings {
  /** Priority assigned to a note when it's first marked as a topic. */
  defaultPriority: number;
  /** Folder new extracts go in. Empty means beside their source note. */
  extractFolder: string;
  /**
   * When true, Extract creates a standalone note (GitHub #1).
   * Default false keeps DESIGN §2: extracts stay anchored in the source.
   */
  extractCreatesStandaloneNote: boolean;
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
   * When a source note is deleted, orphaned highlights can become their
   * own files (true) or stay as review cards with no new file (false).
   * The prompt still offers both; this is the default if you close it.
   */
  makeNotesWhenSourceDeleted: boolean;
  /**
   * SuperMemo "interwoven learning": within a priority band, shuffle the
   * order of due items so positional memory doesn't leak into recall. Seed
   * is the calendar day, so resuming a session mid-day keeps the same
   * order; a new day produces a fresh permutation. Off restores the
   * pre-feature deterministic order (priority, then due time).
   */
  interleaveSimilarPriority: boolean;
  /**
   * When true, after grading an item, if FSRS and SM-2 disagree enough on
   * the next interval, show an inline picker. Off (default for new
   * installs) silently follows FSRS. Existing vaults without this key
   * are grandfathered on — see resolveShowDivergencePicker.
   */
  showDivergencePicker: boolean;
  /**
   * After a cloze answer is revealed, Space grades this rating (Anki/SM
   * muscle memory). First Space still reveals. Reading cards keep Space
   * as Next. Off leaves Space as reveal-only.
   */
  spaceAfterReveal: "again" | "hard" | "good" | "easy" | "off";
  /**
   * Default mask mode for new image-occlusion cards. "hide-all" masks every
   * rect and tests one (Anki's hide-all-guess-one); "hide-one" masks only
   * the tested rect so the others stay visible as context.
   */
  occlusionDefaultMode: "hide-all" | "hide-one";
  /**
   * FSRS target recall probability at review time (request_retention).
   * Exposed in the stats panel's scheduler section.
   */
  desiredRetention: number;
  /** Fitted FSRS-6 weights driving the scheduler. Absent = defaults. */
  fsrsParams?: FittedParams;
  /**
   * One-deep revert slot: the parameter set active before the last
   * Apply. `null` means "the defaults were active"; absent means no
   * Apply has happened yet (no revert offered).
   */
  fsrsPreviousParams?: FittedParams | null;
}

/** A fitted FSRS parameter set, as persisted in plugin data. */
export interface FittedParams {
  /** 21 FSRS-6 weights. */
  w: number[];
  fsrsVersion: 6;
  /** Epoch ms of the fit. */
  fittedAt: number;
  /** Rated reviews included in the fit. */
  reviewCount: number;
  /** Mean held-out log-loss of this vector at fit time. */
  heldOutLogLoss: number;
  /** Fit ran on under 400 rated reviews. */
  lowData: boolean;
}

export const DEFAULT_SETTINGS: IrSettings = {
  defaultPriority: 33,
  extractFolder: "",
  extractCreatesStandaloneNote: false,
  reviewsPerReading: 3,
  topicFirstInterval: 1,
  topicAFactor: 2,
  topicMaxInterval: 1825,
  ankiDeckName: "IR",
  mercyCeiling: 40,
  mercyPriorityCutoff: 10,
  autoMarkSourceAsTopic: true,
  makeNotesWhenSourceDeleted: true,
  interleaveSimilarPriority: true,
  showDivergencePicker: false,
  spaceAfterReveal: "good",
  occlusionDefaultMode: "hide-all",
  desiredRetention: 0.9,
};

/** Fresh copy so restoring defaults cannot mutate the constant. */
export function cloneDefaultSettings(): IrSettings {
  return { ...DEFAULT_SETTINGS };
}
