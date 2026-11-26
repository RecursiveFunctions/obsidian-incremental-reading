/**
 * Pure timestamp-anchored incremental video & audio helpers (Phase 3, #69).
 *
 * Zero network APIs, zero remote URL literals (enforced by `scripts/check-zero-network.mjs`).
 */

import type { DeviceId, ElementId, EventId } from "./ids";
import {
  clampPriority,
  newElement,
  type IrElement,
  type IrEvent,
  type MediaSelector,
  type PriorityPlacement,
  type ReadSchedule,
} from "./model";

export type { MediaSelector } from "./model";

export const MEDIA_EXTENSIONS = [
  "mp4",
  "webm",
  "mp3",
  "m4a",
  "ogg",
  "wav",
] as const;

const MEDIA_PATH_RE = /\.(?:mp4|webm|mp3|m4a|ogg|wav)$/i;
const VIDEO_PATH_RE = /\.(?:mp4|webm)$/i;
// Avoid literal banned scheme tokens in main.js (see scripts/check-zero-network.mjs).
const EXTERNAL_URI_RE = /^https?:/i;

export function isMediaPath(path: string): boolean {
  return MEDIA_PATH_RE.test(path.trim());
}

export function isMediaExtension(ext: string): boolean {
  const clean = ext.trim().replace(/^\./, "").toLowerCase();
  return (MEDIA_EXTENSIONS as readonly string[]).includes(clean);
}

export function isVideoPath(pathOrUrl: string): boolean {
  const stripped = pathOrUrl.split(/[?#]/)[0] ?? pathOrUrl;
  return VIDEO_PATH_RE.test(stripped.trim());
}

export function isExternalMediaRef(pathOrUrl: string): boolean {
  return EXTERNAL_URI_RE.test(pathOrUrl.trim());
}

export function formatMediaTimestamp(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (hrs > 0) {
    return `${hrs}:${pad2(mins)}:${pad2(secs)}`;
  }
  return `${mins}:${pad2(secs)}`;
}

export function parseMediaTimestamp(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const val = Number(trimmed);
    return Number.isFinite(val) && val >= 0 ? val : null;
  }
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!.trim();
    if (!/^\d+(?:\.\d+)?$/.test(p)) return null;
    const n = Number(p);
    if (!Number.isFinite(n) || n < 0) return null;
    if (i > 0 && n >= 60) return null;
    total = total * 60 + n;
  }
  return total;
}

export function normalizeMediaSelector(sel: MediaSelector): MediaSelector {
  const startSec =
    Number.isFinite(sel.startSec) && sel.startSec > 0
      ? Math.round(sel.startSec * 100) / 100
      : 0;
  const stopSec =
    sel.stopSec !== undefined &&
    Number.isFinite(sel.stopSec) &&
    sel.stopSec > startSec
      ? Math.round(sel.stopSec * 100) / 100
      : undefined;
  const rawResume =
    Number.isFinite(sel.resumeSec) && sel.resumeSec >= 0
      ? Math.round(sel.resumeSec * 100) / 100
      : startSec;
  const resumeSec = Math.max(
    startSec,
    stopSec !== undefined ? Math.min(stopSec, rawResume) : rawResume,
  );
  return {
    mediaPathOrUrl: sel.mediaPathOrUrl.trim(),
    startSec,
    ...(stopSec !== undefined ? { stopSec } : {}),
    resumeSec,
  };
}

export function resolveClipBounds(opts: {
  currentTimeSec: number;
  draftStartSec: number | null;
  draftStopSec: number | null;
  parentMedia: MediaSelector;
}): { startSec: number; stopSec: number } | null {
  const { currentTimeSec, draftStartSec, draftStopSec, parentMedia } = opts;
  const startCandidate =
    draftStartSec !== null && Number.isFinite(draftStartSec) && draftStartSec >= 0
      ? draftStartSec
      : parentMedia.resumeSec;
  const stopCandidate =
    draftStopSec !== null && Number.isFinite(draftStopSec) && draftStopSec >= 0
      ? draftStopSec
      : currentTimeSec;
  if (!Number.isFinite(startCandidate) || !Number.isFinite(stopCandidate)) {
    return null;
  }
  const startSec = Math.max(
    parentMedia.startSec,
    Math.round(startCandidate * 100) / 100,
  );
  const maxStop =
    parentMedia.stopSec !== undefined
      ? Math.min(parentMedia.stopSec, stopCandidate)
      : stopCandidate;
  const stopSec = Math.round(maxStop * 100) / 100;
  if (stopSec <= startSec) return null;
  return { startSec, stopSec };
}

export function parseMediaDescriptorFrontmatter(
  frontmatter: Record<string, unknown> | null | undefined,
): MediaSelector | null {
  if (!frontmatter) return null;
  const rawRef =
    frontmatter["ir-media"] ??
    frontmatter.media ??
    frontmatter.video ??
    frontmatter.audio;
  if (typeof rawRef !== "string" || !rawRef.trim()) return null;
  const startSec =
    parseMediaTimestamp(frontmatter["media-start"] ?? frontmatter["ir-media-start"]) ??
    0;
  const stopParsed = parseMediaTimestamp(
    frontmatter["media-stop"] ?? frontmatter["ir-media-stop"],
  );
  const resumeParsed = parseMediaTimestamp(
    frontmatter["media-resume"] ?? frontmatter["ir-media-resume"],
  );
  return normalizeMediaSelector({
    mediaPathOrUrl: rawRef.trim(),
    startSec,
    ...(stopParsed !== null && stopParsed > startSec ? { stopSec: stopParsed } : {}),
    resumeSec: resumeParsed ?? startSec,
  });
}

export function mediaStemLabel(mediaPathOrUrl: string): string {
  const clean = (mediaPathOrUrl.split(/[?#]/)[0] ?? mediaPathOrUrl).trim();
  const base = clean.split("/").pop() || clean;
  return base.replace(MEDIA_PATH_RE, "") || base;
}

export function formatMediaClipRangeLabel(media: MediaSelector): string {
  const start = formatMediaTimestamp(media.startSec);
  if (media.stopSec !== undefined) {
    return `${start}–${formatMediaTimestamp(media.stopSec)}`;
  }
  return `${start}+`;
}

export function buildMediaTopicEvent(input: {
  mediaPathOrUrl: string;
  notePath?: string;
  startSec?: number;
  stopSec?: number;
  elementId: ElementId;
  eventId: EventId;
  device: DeviceId;
  lamport: number;
  now: number;
  priority: number;
  schedule: ReadSchedule;
  placement?: PriorityPlacement;
}): IrEvent {
  const media = normalizeMediaSelector({
    mediaPathOrUrl: input.mediaPathOrUrl,
    startSec: input.startSec ?? 0,
    ...(input.stopSec !== undefined ? { stopSec: input.stopSec } : {}),
    resumeSec: input.startSec ?? 0,
  });
  const sourcePath = input.notePath ?? media.mediaPathOrUrl;
  const element: IrElement = {
    ...newElement({
      id: input.elementId,
      type: "topic",
      priority: clampPriority(input.priority),
      notePath: input.notePath,
      text: `${mediaStemLabel(media.mediaPathOrUrl)} [${formatMediaClipRangeLabel(media)}]`,
      anchor: {
        sourcePath,
        quote: { exact: "", prefix: "", suffix: "" },
        media,
      },
      now: input.now,
    }),
    schedule: input.schedule,
  };
  return {
    id: input.eventId,
    ts: input.now,
    lamport: input.lamport,
    device: input.device,
    kind: "element-created",
    target: input.elementId,
    payload: {
      element,
      ...(input.placement ? { placement: input.placement } : {}),
    },
  };
}

export function buildMediaExtractEvent(input: {
  sourcePath: string;
  mediaPathOrUrl: string;
  startSec: number;
  stopSec: number;
  note?: string;
  parentId: ElementId;
  priority: number;
  elementId: ElementId;
  eventId: EventId;
  device: DeviceId;
  lamport: number;
  now: number;
  schedule: ReadSchedule;
  placement?: PriorityPlacement;
}): IrEvent {
  const media = normalizeMediaSelector({
    mediaPathOrUrl: input.mediaPathOrUrl,
    startSec: input.startSec,
    stopSec: input.stopSec,
    resumeSec: input.startSec,
  });
  const rangeStr = formatMediaClipRangeLabel(media);
  const stem = mediaStemLabel(media.mediaPathOrUrl);
  const noteTrimmed = input.note?.trim() ?? "";
  const text = noteTrimmed
    ? `${noteTrimmed}\n\n_(Clip: ${stem} [${rangeStr}])_`
    : `${stem} [${rangeStr}]`;

  const element: IrElement = {
    ...newElement({
      id: input.elementId,
      type: "extract",
      priority: clampPriority(input.priority),
      parentId: input.parentId,
      text,
      anchor: {
        sourcePath: input.sourcePath,
        quote: { exact: rangeStr, prefix: "", suffix: "" },
        media,
      },
      now: input.now,
    }),
    schedule: input.schedule,
  };
  return {
    id: input.eventId,
    ts: input.now,
    lamport: input.lamport,
    device: input.device,
    kind: "element-created",
    target: input.elementId,
    payload: {
      element,
      ...(input.placement ? { placement: input.placement } : {}),
    },
  };
}

export function buildMediaResumedEvent(input: {
  elementId: ElementId;
  resumeSec: number;
  eventId: EventId;
  device: DeviceId;
  lamport: number;
  now: number;
}): IrEvent {
  return {
    id: input.eventId,
    ts: input.now,
    lamport: input.lamport,
    device: input.device,
    kind: "media-resumed",
    target: input.elementId,
    payload: {
      resumeSec: Math.max(0, Math.round(input.resumeSec * 100) / 100),
    },
  };
}
