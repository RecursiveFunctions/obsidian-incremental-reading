/**
 * Settings keys that need a one-time grandfather when introduced.
 * Kept pure so tests don't import Obsidian.
 */

/**
 * Divergence picker (DESIGN §5): new installs default off. Existing
 * vaults already saw the picker on every divergent grade, so a missing
 * key in saved data means "keep expert mode on."
 */
export function resolveShowDivergencePicker(
  saved: { showDivergencePicker?: boolean } | null | undefined,
): boolean {
  if (saved == null) return false;
  if (Object.prototype.hasOwnProperty.call(saved, "showDivergencePicker")) {
    return saved.showDivergencePicker === true;
  }
  return true;
}
