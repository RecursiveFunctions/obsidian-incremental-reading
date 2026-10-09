import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildClozedBody,
  suggestCaptureMode,
  validateCapture,
} from "../src/ir/capture";

test("validateCapture: empty text is invalid", () => {
  const result = validateCapture({ text: "", mode: "extract" });
  assert.equal(result.valid, false);
  assert.equal(result.error, "Nothing to capture.");
});

test("validateCapture: whitespace-only text is invalid", () => {
  const result = validateCapture({ text: "   ", mode: "extract" });
  assert.equal(result.valid, false);
});

test("validateCapture: valid extract", () => {
  const result = validateCapture({ text: "Some text to extract", mode: "extract" });
  assert.equal(result.valid, true);
  assert.equal(result.text, "Some text to extract");
  assert.equal(result.mode, "extract");
});

test("validateCapture: cloze without body is invalid", () => {
  const result = validateCapture({ text: "text", mode: "cloze" });
  assert.equal(result.valid, false);
  assert.equal(result.error, "Cloze body is empty.");
});

test("validateCapture: valid cloze with body", () => {
  const result = validateCapture({
    text: "The capital of France is Paris.",
    mode: "cloze",
    clozedBody: "The capital of France is {{c1::Paris}}.",
  });
  assert.equal(result.valid, true);
  assert.equal(result.clozedBody, "The capital of France is {{c1::Paris}}.");
});

test("validateCapture: topic without title is invalid", () => {
  const result = validateCapture({ text: "Some topic text", mode: "topic" });
  assert.equal(result.valid, false);
  assert.equal(result.error, "Title is required.");
});

test("validateCapture: valid topic with title", () => {
  const result = validateCapture({
    text: "Some topic text",
    mode: "topic",
    title: "My Topic",
  });
  assert.equal(result.valid, true);
  assert.equal(result.title, "My Topic");
});

test("buildClozedBody: wraps full text as cloze", () => {
  const body = buildClozedBody("Hello world", 0, 11);
  assert.equal(body, "{{c1::Hello world}}");
});

test("buildClozedBody: wraps partial text as cloze", () => {
  const body = buildClozedBody("The answer is 42", 14, 16);
  assert.equal(body, "The answer is {{c1::42}}");
});

test("buildClozedBody: with hint", () => {
  const body = buildClozedBody("The answer is 42", 14, 16, "a number");
  assert.equal(body, "The answer is {{c1::42::a number}}");
});

test("buildClozedBody: empty range returns raw", () => {
  const body = buildClozedBody("Hello", 0, 0);
  assert.equal(body, "Hello");
});

test("suggestCaptureMode: short text suggests cloze", () => {
  assert.equal(suggestCaptureMode("Paris"), "cloze");
  assert.equal(suggestCaptureMode("New York City"), "cloze");
});

test("suggestCaptureMode: long text suggests extract", () => {
  assert.equal(
    suggestCaptureMode("The capital of France is Paris and it has many landmarks"),
    "extract",
  );
});

test("suggestCaptureMode: empty text suggests extract", () => {
  assert.equal(suggestCaptureMode(""), "extract");
});
