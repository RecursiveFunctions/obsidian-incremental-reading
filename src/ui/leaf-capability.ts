/**
 * Per-leaf container width (`ResizeObserver`), pointer precision (`(pointer: coarse)`),
 * and non-IME hardware keyboard latch controller (#65).
 */

import {
  resolveViewportCapability,
  shouldLatchHardwareKeyboard,
  type ViewportCapability,
} from "../ir/viewport-tiers";

let latchedHardwareKeyboard = false;
const kbListeners = new Set<() => void>();
let docKeyListenerInstalled = false;

function isEditableElement(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest('.cm-editor, .cm-content, [contenteditable="true"]'));
}

function ensureGlobalHardwareKeyboardProbe(doc: Document): void {
  if (docKeyListenerInstalled) return;
  docKeyListenerInstalled = true;
  doc.addEventListener(
    "keydown",
    (ev: KeyboardEvent) => {
      if (latchedHardwareKeyboard) return;
      if (shouldLatchHardwareKeyboard(ev, isEditableElement(doc.activeElement))) {
        latchedHardwareKeyboard = true;
        for (const fn of kbListeners) fn();
      }
    },
    { capture: true, passive: true },
  );
}

export interface LeafCapabilityHandle {
  getCapability(): ViewportCapability;
  destroy(): void;
}

export function attachLeafCapabilityController(
  hostEl: HTMLElement,
  onChange?: (cap: ViewportCapability) => void,
): LeafCapabilityHandle {
  const doc = hostEl.ownerDocument ?? document;
  const win = doc.defaultView ?? window;
  ensureGlobalHardwareKeyboardProbe(doc);

  const mql =
    typeof win.matchMedia === "function" ? win.matchMedia("(pointer: coarse)") : null;

  const measure = (): ViewportCapability => {
    const rectWidth = hostEl.clientWidth || hostEl.getBoundingClientRect().width || win.innerWidth || 0;
    const coarse = Boolean(mql?.matches);
    return resolveViewportCapability({
      inlineWidthPx: rectWidth,
      coarsePointer: coarse,
      latchedHardwareKeyboard,
    });
  };

  let current = measure();
  const applyAttrs = (cap: ViewportCapability) => {
    if (hostEl.dataset.irTier !== cap.tier) {
      hostEl.dataset.irTier = cap.tier;
    }
    const ptr = cap.touchTargets ? "coarse" : "fine";
    if (hostEl.dataset.irPointer !== ptr) {
      hostEl.dataset.irPointer = ptr;
    }
    const kb = cap.showHotkeys ? "true" : "false";
    if (hostEl.dataset.irKb !== kb) {
      hostEl.dataset.irKb = kb;
    }
  };
  applyAttrs(current);

  let rafId: number | null = null;
  let destroyed = false;

  const sync = (notify: boolean) => {
    if (destroyed) return;
    const next = measure();
    const changed =
      next.tier !== current.tier ||
      next.touchTargets !== current.touchTargets ||
      next.showHotkeys !== current.showHotkeys ||
      next.sourceLayout !== current.sourceLayout;
    current = next;
    applyAttrs(next);
    if (changed && notify && onChange) {
      if (rafId !== null) win.cancelAnimationFrame(rafId);
      rafId = win.requestAnimationFrame(() => {
        rafId = null;
        if (!destroyed) onChange(current);
      });
    }
  };

  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => sync(true))
      : null;
  ro?.observe(hostEl);

  const onMediaChange = () => sync(true);
  if (mql) {
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onMediaChange);
    } else if (typeof mql.addListener === "function") {
      mql.addListener(onMediaChange);
    }
  }

  const onKbLatch = () => sync(true);
  kbListeners.add(onKbLatch);

  return {
    getCapability: () => current,
    destroy: () => {
      destroyed = true;
      if (rafId !== null) win.cancelAnimationFrame(rafId);
      ro?.disconnect();
      if (mql) {
        if (typeof mql.removeEventListener === "function") {
          mql.removeEventListener("change", onMediaChange);
        } else if (typeof mql.removeListener === "function") {
          mql.removeListener(onMediaChange);
        }
      }
      kbListeners.delete(onKbLatch);
    },
  };
}
