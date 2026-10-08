import { clampPriority, PRIORITY_MAX, PRIORITY_MIN } from "./ir/model";
import { formatPriority } from "./ir/relative-priority";
import {
  previewPriorityPlacement,
  priorityForPosition,
  type PriorityPlacementPreview,
} from "./ir/relative-priority";
import type { ElementId } from "./ir/ids";
import type { IrElement } from "./ir/model";

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

export interface RichPriorityEditorOptions {
  targetId: ElementId;
  elements: readonly IrElement[];
  labelFor: (element: IrElement) => string;
  onCommit: (preview: PriorityPlacementPreview) => void;
  onCancel?: () => void;
  title?: string;
  restoreFocus?: HTMLElement;
}

export function mountPriorityEditor(
  host: HTMLElement,
  options: RichPriorityEditorOptions,
): PriorityPromptHandle {
  const target = options.elements.find((element) => element.id === options.targetId);
  const initial = target?.priority ?? 50;
  host.empty();
  host.addClass("ir-priority-editor");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  host.createEl("div", {
    cls: "ir-priority-editor-title",
    text: options.title ?? `Move “${target ? options.labelFor(target) : "element"}”`,
  });
  const positionField = host.createEl("label", { cls: "ir-priority-field" });
  positionField.createSpan({ text: "Position" });
  const position = host.createEl("input", { cls: "ir-priority-position" }) as HTMLInputElement;
  positionField.appendChild(position);
  position.type = "number";
  position.min = "1";
  position.max = String(Math.max(1, options.elements.length));
  const total = positionField.createSpan({ cls: "ir-priority-total" });
  const percentField = host.createEl("label", { cls: "ir-priority-field" });
  percentField.createSpan({ text: "Percentage" });
  const percent = percentField.createEl("input", { cls: "ir-priority-input" }) as HTMLInputElement;
  percent.type = "number";
  percent.min = String(PRIORITY_MIN);
  percent.max = String(PRIORITY_MAX);
  percent.step = "0.0001";
  percent.value = formatPriority(initial);
  const neighbors = host.createDiv({ cls: "ir-priority-neighbors" });
  const disclosure = host.createEl("details", { cls: "ir-priority-near" });
  disclosure.createEl("summary", { text: "Place near another element" });
  const search = disclosure.createEl("input", { cls: "ir-priority-search" }) as HTMLInputElement;
  search.type = "search";
  search.placeholder = "Search collection";
  const results = disclosure.createDiv({ cls: "ir-priority-results" });
  let preview = previewPriorityPlacement(options.elements, options.targetId, initial);
  let closed = false;
  const render = () => {
    preview = previewPriorityPlacement(options.elements, options.targetId,
      parseCandidatePriority(percent.value) ?? initial);
    position.value = String(preview.finalPosition);
    total.setText(`of ${preview.total}`);
    const before = preview.beforeId
      ? options.elements.find((element) => element.id === preview.beforeId) : undefined;
    const after = preview.afterId
      ? options.elements.find((element) => element.id === preview.afterId) : undefined;
    neighbors.setText(`After: ${after ? options.labelFor(after) : "start"} · Before: ${before ? options.labelFor(before) : "end"}`);
  };
  const close = (commit: boolean) => {
    if (closed) return;
    closed = true;
    if (commit) options.onCommit(preview);
    else options.onCancel?.();
    options.restoreFocus?.focus();
  };
  percent.addEventListener("input", render);
  position.addEventListener("input", () => {
    const value = Number(position.value);
    if (!Number.isFinite(value)) return;
    percent.value = formatPriority(priorityForPosition(value, Math.max(1, options.elements.length)));
    render();
  });
  search.addEventListener("input", () => {
    results.empty();
    const query = search.value.trim().toLowerCase();
    if (!query) return;
    for (const element of options.elements.filter((candidate) => candidate.id !== options.targetId &&
      options.labelFor(candidate).toLowerCase().includes(query)).slice(0, 8)) {
      const row = results.createDiv({ cls: "ir-priority-result" });
      row.createSpan({ text: options.labelFor(element) });
      const place = (after: boolean) => {
        const index = options.elements
          .filter((candidate) => candidate.id !== options.targetId)
          .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
          .findIndex((candidate) => candidate.id === element.id);
        position.value = String(index + 1 + (after ? 1 : 0));
        position.dispatchEvent(new Event("input"));
      };
      row.createEl("button", { text: "Place before" }).onclick = () => place(false);
      row.createEl("button", { text: "Place after" }).onclick = () => place(true);
    }
  });
  const actions = host.createDiv({ cls: "ir-priority-actions" });
  actions.createEl("button", { text: "Move", cls: "mod-cta" }).onclick = () => close(true);
  actions.createEl("button", { text: "Cancel" }).onclick = () => close(false);
  host.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target !== search) close(true);
    if (event.key === "Escape") close(false);
    if (event.key === "Tab") {
      const focusable = Array.from(host.querySelectorAll<HTMLElement>(
        "button, input, summary, [tabindex]:not([tabindex='-1'])",
      )).filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  render();
  setTimeout(() => position.focus(), 0);
  return { cancel: () => close(false) };
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
  input.step = "0.0001";
  input.value = formatPriority(current);

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
