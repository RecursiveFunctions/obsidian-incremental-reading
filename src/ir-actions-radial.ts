import type { App } from "obsidian";
import { Platform, setIcon } from "obsidian";

import { radialRadius } from "./ir/mobile-viewport";

export type IrHubEntry = {
  title: string;
  description?: string;
  icon?: string;
  run: () => void | Promise<void>;
};

const EMPTY_HELP_LINES: string[] = [
  "Start IR review and the element tree are on this ring whenever you are not already in a session. Go neural appears once the current note is in Incremental Reading.",
  "",
  "New cloze (separate card): select text in a Markdown note, then tap the IR FAB or open the wheel. On an IR item, the new card is filed under that item’s ir-parent.",
  "",
  "Split clozes: open an IR item note whose body has two or more {{cN::…}} groups.",
  "",
  "Fork extract: open a promoted extract note, or right-click an extract row in the IR tree.",
  "",
  "Tip: Alt+Shift+U opens the wheel; it is centered on the active pane.",
];

function petalCaption(title: string): string {
  const t = title.trim();
  if (t.length <= 20) return t;
  return `${t.slice(0, 18)}…`;
}

/**
 * Full-screen overlay with a radial action ring. Always opens (even when
 * there are zero actions) so the gesture stays predictable; empty state
 * explains what would unlock each action.
 */
export function openIrRadialQuickMenu(
  app: App,
  entries: IrHubEntry[],
  origin: { cx: number; cy: number },
): void {
  const doc = app.workspace.containerEl.ownerDocument;
  const win = doc.defaultView ?? window;

  const root = app.workspace.containerEl.createDiv({ cls: "ir-radial-root" });
  // Dialog semantics: the overlay covers the app behind a backdrop, so a
  // screen reader (and Tab) must treat it as the whole world until it
  // closes. Without this, Tab walked straight into the dimmed app.
  root.setAttr("role", "dialog");
  root.setAttr("aria-modal", "true");
  root.setAttr("aria-label", "IR quick actions");
  const previouslyFocused =
    doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const backdrop = root.createDiv({ cls: "ir-radial-backdrop" });
  const disk = root.createDiv({ cls: "ir-radial-disk" });
  disk.style.left = `${origin.cx}px`;
  disk.style.top = `${origin.cy}px`;

  const center = disk.createDiv({ cls: "ir-radial-center" });
  if (entries.length === 0) center.addClass("ir-radial-center--wide");
  center.createDiv({ cls: "ir-radial-center-title", text: "IR quick actions" });
  const hint = center.createDiv({ cls: "ir-radial-center-hint" });
  if (entries.length === 0) {
    hint.addClass("ir-radial-center-hint--empty");
    for (const line of EMPTY_HELP_LINES) {
      if (line === "") hint.createEl("br");
      else hint.createEl("p", { text: line });
    }
  } else {
    hint.setText(
      `Tap a ring button (${entries.length} available). Keys 1–${Math.min(entries.length, 9)} also work.`,
    );
  }

  const closeBtn = center.createEl("button", {
    cls: "mod-muted ir-radial-close",
    text: "Close",
    type: "button",
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    win.removeEventListener("keydown", onKey, true);
    root.remove();
    // Put the caret back where the user left it; an overlay that eats focus
    // and never returns it strands keyboard users in the document body.
    previouslyFocused?.focus?.();
  };

  const runEntry = (e: IrHubEntry) => {
    close();
    void Promise.resolve(e.run()).catch((err) => {
      console.error("Incremental Reading: radial action failed", err);
    });
  };

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);

  const orbit = disk.createDiv({ cls: "ir-radial-orbit" });
  const n = entries.length;
  const R = radialRadius(n, Platform.isMobile);
  for (let i = 0; i < n; i += 1) {
    const e = entries[i]!;
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const x = Math.cos(angle) * R;
    const y = Math.sin(angle) * R;
    const petal = orbit.createEl("button", {
      cls: "ir-radial-petal",
      type: "button",
      attr: {
        "aria-label": e.title,
        title: e.description ?? e.title,
      },
    });
    petal.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    if (i < 9) {
      petal.createDiv({ cls: "ir-radial-petal-key", text: String(i + 1) });
    }
    if (e.icon) {
      const ic = petal.createDiv({ cls: "ir-radial-petal-icon" });
      setIcon(ic, e.icon);
    }
    petal.createDiv({ cls: "ir-radial-petal-label", text: petalCaption(e.title) });
    petal.addEventListener("click", (ev) => {
      ev.stopPropagation();
      runEntry(e);
    });
  }

  /** Focusables inside the overlay, in DOM order. */
  const focusables = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>("button:not([disabled])"));

  function onKey(evt: KeyboardEvent): void {
    if (evt.key === "Tab") {
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = doc.activeElement;
      // Cycle within the overlay rather than letting Tab escape behind the
      // backdrop, where every target is visually dimmed and unreachable.
      if (evt.shiftKey && (active === first || !root.contains(active))) {
        evt.preventDefault();
        last.focus();
      } else if (!evt.shiftKey && active === last) {
        evt.preventDefault();
        first.focus();
      }
      return;
    }
    if (evt.key === "Escape") {
      evt.preventDefault();
      evt.stopPropagation();
      close();
      return;
    }
    if (!closed && n > 0) {
      const d = evt.code.match(/^Digit([1-9])$/);
      if (d) {
        const idx = Number(d[1]) - 1;
        if (idx >= 0 && idx < n) {
          evt.preventDefault();
          evt.stopPropagation();
          runEntry(entries[idx]!);
        }
      }
    }
  }
  win.addEventListener("keydown", onKey, true);
  // Land on the first action so the ring is usable without a pointer.
  (focusables()[0] ?? closeBtn).focus();
}
