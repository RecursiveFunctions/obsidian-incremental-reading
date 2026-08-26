/**
 * Crop a region out of a vault image. Decodes from the vault bytes (not
 * the rendered `<img>`) so the canvas is never tainted by the app://
 * scheme. Returns PNG bytes.
 */

import type { NormalizedRect } from "./model";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

export function imageMimeFor(extension: string): string {
  return MIME[extension.toLowerCase()] ?? "application/octet-stream";
}

export async function cropImageBytes(
  data: ArrayBuffer,
  extension: string,
  rect: NormalizedRect,
): Promise<ArrayBuffer | null> {
  const blob = new Blob([data], { type: imageMimeFor(extension) });
  const bitmap = await createImageBitmap(blob);
  try {
    const sx = Math.floor(rect.x * bitmap.width);
    const sy = Math.floor(rect.y * bitmap.height);
    const sw = Math.max(1, Math.round(rect.w * bitmap.width));
    const sh = Math.max(1, Math.round(rect.h * bitmap.height));
    const out = document.createElement("canvas");
    out.width = sw;
    out.height = sh;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    const png = await new Promise<Blob | null>((resolve) =>
      out.toBlob((b) => resolve(b), "image/png"),
    );
    return png ? png.arrayBuffer() : null;
  } finally {
    bitmap.close();
  }
}
