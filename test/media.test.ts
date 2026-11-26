import assert from "node:assert/strict";
import { test } from "node:test";
import { newDeviceId, newElementId, newEventId } from "../src/ir/ids";
import { fold } from "../src/ir/log";
import { labelFor } from "../src/ir/labels";
import { validateIrEvent, type IrEvent } from "../src/ir/model";
import {
  buildMediaExtractEvent,
  buildMediaResumedEvent,
  buildMediaTopicEvent,
  formatMediaTimestamp,
  isExternalMediaRef,
  isMediaPath,
  isVideoPath,
  normalizeMediaSelector,
  parseMediaDescriptorFrontmatter,
  parseMediaTimestamp,
  resolveClipBounds,
} from "../src/ir/media";

const NOW = 1_760_000_000_000;
const DEV = newDeviceId();

test("isMediaPath, isVideoPath, and isExternalMediaRef classify local and external media without URL literals (#69)", () => {
  assert.equal(isMediaPath("Lectures/Week1.mp4"), true);
  assert.equal(isMediaPath("Audio/podcast.MP3"), true);
  assert.equal(isMediaPath("Audio/voice.m4a"), true);
  assert.equal(isMediaPath("Audio/clip.ogg"), true);
  assert.equal(isMediaPath("Audio/clip.wav"), true);
  assert.equal(isMediaPath("Video/talk.webm"), true);
  assert.equal(isMediaPath("Notes/topic.md"), false);

  assert.equal(isVideoPath("Lectures/Week1.mp4"), true);
  assert.equal(isVideoPath("Video/talk.WEBM"), true);
  assert.equal(isVideoPath("Audio/podcast.mp3"), false);

  const scheme = ["ht", "tps", "://example.com/lecture.mp4"].join("");
  assert.equal(isExternalMediaRef(scheme), true);
  assert.equal(isExternalMediaRef("Lectures/Week1.mp4"), false);
});

test("formatMediaTimestamp and parseMediaTimestamp round-trip seconds and H:MM:SS (#69)", () => {
  assert.equal(formatMediaTimestamp(0), "0:00");
  assert.equal(formatMediaTimestamp(83.4), "1:23");
  assert.equal(formatMediaTimestamp(3661), "1:01:01");

  assert.equal(parseMediaTimestamp("0:00"), 0);
  assert.equal(parseMediaTimestamp("1:23"), 83);
  assert.equal(parseMediaTimestamp("1:01:01"), 3661);
  assert.equal(parseMediaTimestamp("42.5"), 42.5);
  assert.equal(parseMediaTimestamp("invalid"), null);
});

test("normalizeMediaSelector & resolveClipBounds enforce [start, stop] and [resume, currentTime] invariants (#69)", () => {
  const norm = normalizeMediaSelector({
    mediaPathOrUrl: "Media/talk.mp4",
    startSec: 10,
    stopSec: 50,
    resumeSec: 3, // clamped up to startSec
  });
  assert.equal(norm.resumeSec, 10);

  // Explicit draft [start, stop] wins
  assert.deepEqual(
    resolveClipBounds({
      currentTimeSec: 120,
      draftStartSec: 30,
      draftStopSec: 75,
      parentMedia: { mediaPathOrUrl: "Media/talk.mp4", startSec: 0, resumeSec: 15 },
    }),
    { startSec: 30, stopSec: 75 },
  );

  // Fallback uses [parentMedia.resumeSec, currentTimeSec]
  assert.deepEqual(
    resolveClipBounds({
      currentTimeSec: 64,
      draftStartSec: null,
      draftStopSec: null,
      parentMedia: { mediaPathOrUrl: "Media/talk.mp4", startSec: 0, resumeSec: 20 },
    }),
    { startSec: 20, stopSec: 64 },
  );

  // Rejects empty or inverted range
  assert.equal(
    resolveClipBounds({
      currentTimeSec: 20,
      draftStartSec: null,
      draftStopSec: null,
      parentMedia: { mediaPathOrUrl: "Media/talk.mp4", startSec: 0, resumeSec: 20 },
    }),
    null,
  );
});

test("parseMediaDescriptorFrontmatter extracts media path/URI and optional timestamps (#69)", () => {
  const parsed = parseMediaDescriptorFrontmatter({
    media: "Audio/episode1.mp3",
    "media-start": "1:30",
    "media-stop": "4:00",
  });
  assert.deepEqual(parsed, {
    mediaPathOrUrl: "Audio/episode1.mp3",
    startSec: 90,
    stopSec: 240,
    resumeSec: 90,
  });
});

test("media topic, clip extract, and media-resumed events validate, fold, and format labels (#69)", () => {
  const topicId = newElementId();
  const clipId = newElementId();
  const topicEv = buildMediaTopicEvent({
    mediaPathOrUrl: "Lectures/DSP.mp4",
    notePath: "Lectures/DSP.mp4",
    elementId: topicId,
    eventId: newEventId(),
    device: DEV,
    lamport: 1,
    now: NOW,
    priority: 25,
    schedule: { due: NOW + 86_400_000, interval: 1, aFactor: 2 },
  });
  assert.equal(validateIrEvent(topicEv), null);

  const clipEv = buildMediaExtractEvent({
    sourcePath: "Lectures/DSP.mp4",
    mediaPathOrUrl: "Lectures/DSP.mp4",
    startSec: 80,
    stopSec: 225,
    note: "Sampling theorem derivation",
    parentId: topicId,
    priority: 18,
    elementId: clipId,
    eventId: newEventId(),
    device: DEV,
    lamport: 2,
    now: NOW + 1000,
    schedule: { due: NOW + 86_400_000, interval: 1, aFactor: 1.8 },
  });
  assert.equal(validateIrEvent(clipEv), null);

  const resumeEv = buildMediaResumedEvent({
    elementId: topicId,
    resumeSec: 225,
    eventId: newEventId(),
    device: DEV,
    lamport: 3,
    now: NOW + 2000,
  });
  assert.equal(validateIrEvent(resumeEv), null);

  const events: IrEvent[] = [topicEv, clipEv, resumeEv];
  const state = fold(events);
  const foldedTopic = state.elements.get(topicId)!;
  const foldedClip = state.elements.get(clipId)!;

  assert.equal(foldedTopic.anchor?.media?.resumeSec, 225);
  assert.equal(foldedClip.anchor?.media?.startSec, 80);
  assert.equal(foldedClip.anchor?.media?.stopSec, 225);
  assert.equal(foldedClip.anchor?.media?.resumeSec, 80);
  assert.match(labelFor(foldedClip), /1:20.*3:45|Sampling theorem/);
});
