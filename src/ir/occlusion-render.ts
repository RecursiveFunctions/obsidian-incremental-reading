/**
 * Render an image occlusion spec into a host element: the image plus
 * absolutely-positioned rect masks and SVG polygon masks (`THitEditor`).
 */

import { maskPlan, polygonMaskPlan, type OcclusionSpec } from "./occlusion";

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

  const polyPlan = polygonMaskPlan(spec, opts.revealed);
  if (polyPlan.length > 0) {
    const svg = root.createSvg("svg", {
      cls: "ir-occlusion-poly-layer",
      attr: { viewBox: "0 0 100 100", preserveAspectRatio: "none" },
    });
    svg.style.position = "absolute";
    svg.style.inset = "0";
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.pointerEvents = opts.interactive ? "auto" : "none";

    for (const pm of polyPlan) {
      const pts = pm.polygon.points
        .map(([x, y]) => `${(x * 100).toFixed(2)},${(y * 100).toFixed(2)}`)
        .join(" ");
      const polyEl = svg.createSvg("polygon", {
        cls: `ir-occlusion-poly${pm.active ? " ir-occlusion-mask--active" : ""}`,
        attr: {
          points: pts,
          fill: pm.masked
            ? pm.active
              ? "var(--interactive-accent)"
              : "var(--background-secondary-alt)"
            : "transparent",
          stroke: pm.active ? "var(--interactive-accent)" : "var(--background-modifier-border)",
          "stroke-width": "0.8",
        },
      });
      if (opts.interactive && pm.active) {
        polyEl.style.cursor = "pointer";
        polyEl.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          opts.onToggle?.();
        });
      }
    }
  }

  return root;
}
