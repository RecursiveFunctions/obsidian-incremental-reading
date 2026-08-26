/**
 * Render an image occlusion spec into a host element: the image plus one
 * absolutely-positioned mask per rect. Used by the `ir-occlusion` code-block
 * processor (reading view, review card) and by the editor preview.
 *
 * Geometry goes through inline `style` because it is data, not theme;
 * colors and typography come from CSS variables (UI commitment #3).
 */

import { maskPlan, type OcclusionSpec } from "./occlusion";

export interface RenderOcclusionOptions {
  revealed: boolean;
  /** Clicking the active mask toggles reveal (plain note preview). */
  interactive?: boolean;
  onToggle?: () => void;
}

export const OCCLUSION_REVEALED_CLASS = "ir-occlusion--revealed";

export function renderOcclusion(
  host: HTMLElement,
  spec: OcclusionSpec,
  imageUrl: string,
  opts: RenderOcclusionOptions,
): HTMLElement {
  host.empty();
  const root = host.createDiv({ cls: "ir-occlusion" });
  if (opts.revealed) root.addClass(OCCLUSION_REVEALED_CLASS);
  root.setAttr("data-ir-occlusion-active", String(spec.active));
  const img = root.createEl("img", { cls: "ir-occlusion-img" });
  img.setAttr("src", imageUrl);
  img.setAttr("alt", "");
  img.setAttr("draggable", "false");
  for (const m of maskPlan(spec, opts.revealed)) {
    const mask = root.createDiv({ cls: "ir-occlusion-mask" });
    mask.style.left = `${m.rect.x * 100}%`;
    mask.style.top = `${m.rect.y * 100}%`;
    mask.style.width = `${m.rect.w * 100}%`;
    mask.style.height = `${m.rect.h * 100}%`;
    if (m.active) mask.addClass("ir-occlusion-mask--active");
    mask.addClass(
      m.masked ? "ir-occlusion-mask--masked" : "ir-occlusion-mask--open",
    );
    if (m.active && m.rect.label) {
      // Hidden: label is the hint. Revealed: label is the caption.
      mask.createSpan({ cls: "ir-occlusion-label", text: m.rect.label });
      mask.setAttr("aria-label", m.rect.label);
    }
    if (opts.interactive && m.active) {
      mask.addClass("ir-occlusion-mask--clickable");
      mask.setAttr("role", "button");
      mask.setAttr("tabindex", "0");
      mask.addEventListener("click", (evt) => {
        evt.preventDefault();
        evt.stopPropagation();
        opts.onToggle?.();
      });
      mask.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          opts.onToggle?.();
        }
      });
    }
  }
  return root;
}
