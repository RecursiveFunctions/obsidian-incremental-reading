import { clampPriority, PRIORITY_MAX, PRIORITY_MIN } from "./ir/model";

/**
 * Parse a status-bar priority input. Returns null on unparseable input so
 * the caller can keep the prompt open rather than persist garbage.
 */
export function parseCandidatePriority(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return clampPriority(n);
}

export interface PriorityPromptHandle {
  cancel(): void;
}

/**
 * Reuses the status-bar element from UI commitment #4 as a transient input
 * surface for UI commitment #6 (non-modal priority editing). Captures the
 * status-bar's current DOM as a snapshot; Enter commits, Esc / blur cancels
 * and restores the snapshot.
 */
export function openPriorityPrompt(
  statusBarEl: HTMLElement,
  current: number,
  onCommit: (priority: number) => void,
  onCancel?: () => void,
): PriorityPromptHandle {
  const snapshot = statusBarEl.innerHTML;
  const restore = () => {
    statusBarEl.innerHTML = snapshot;
  };

  statusBarEl.empty();
  statusBarEl.addClass("ir-priority-prompt");

  statusBarEl.createSpan({
    cls: "ir-priority-prompt-label",
    text: "IR priority: ",
  });
  const input = statusBarEl.createEl("input", {
    cls: "ir-priority-prompt-input",
  }) as HTMLInputElement;
  input.type = "number";
  input.min = String(PRIORITY_MIN);
  input.max = String(PRIORITY_MAX);
  input.value = String(clampPriority(current));

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    statusBarEl.removeClass("ir-priority-prompt");
    restore();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const v = parseCandidatePriority(input.value);
      if (v === null) return;
      close();
      onCommit(v);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
      onCancel?.();
    }
  });
  input.addEventListener("blur", () => {
    if (closed) return;
    close();
    onCancel?.();
  });

  setTimeout(() => input.focus(), 0);

  return {
    cancel: () => {
      if (closed) return;
      close();
      onCancel?.();
    },
  };
}
