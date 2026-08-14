/**
 * Optional cloze hint (SuperMemo-style). Inline bar — not a Modal —
 * so Alt+Z in the editor matches the review dock (UI commitment #6).
 *
 * Empty hint is allowed (`ok: true`, `hint: ""`). Cancel / Esc yields
 * `ok: false`.
 */

import { Notice } from "obsidian";

export type ClozeHintPromptResult =
  | { ok: true; hint: string }
  | { ok: false };

/**
 * Mount a hint bar at the top of `host`. Replaces any existing `.ir-hint-bar`
 * in that host. Snapshot the editor/review selection *before* awaiting this
 * — the input steals focus.
 */
export function promptClozeHintInline(
  host: HTMLElement,
): Promise<ClozeHintPromptResult> {
  return new Promise((resolve) => {
    const existing = host.querySelector(".ir-hint-bar");
    if (existing) existing.remove();

    const bar = host.createDiv({ cls: "ir-hint-bar" });
    host.prepend(bar);

    bar.createSpan({
      cls: "ir-hint-bar-label",
      text: "Cloze hint (optional):",
    });
    const input = bar.createEl("input", {
      cls: "ir-hint-bar-input",
      type: "text",
      placeholder: "e.g. capital of France — Enter to confirm, Esc to cancel",
    });
    const submit = bar.createEl("button", {
      cls: "mod-cta ir-hint-bar-btn",
      text: "OK",
    });
    const cancel = bar.createEl("button", {
      cls: "ir-hint-bar-btn",
      text: "Cancel",
    });

    let finished = false;
    const finish = (r: ClozeHintPromptResult) => {
      if (finished) return;
      finished = true;
      bar.remove();
      resolve(r);
    };

    const trySubmit = () => {
      const trimmed = input.value.trim();
      if (trimmed.includes("::")) {
        new Notice(
          'Incremental Reading: hints cannot contain "::" (reserved for cloze syntax).',
        );
        return;
      }
      finish({ ok: true, hint: trimmed });
    };

    // stopPropagation: finish() removes this input before bubble completes.
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        trySubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        finish({ ok: false });
      }
    });
    submit.addEventListener("click", () => trySubmit());
    cancel.addEventListener("click", () => finish({ ok: false }));

    requestAnimationFrame(() => input.focus());
  });
}
