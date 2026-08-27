import assert from "node:assert/strict";
import test from "node:test";
import {
  audioLevel,
  describeRetellError,
  parseRetellTranscript,
  reconcileRetellTranscript,
} from "./retell-helpers.ts";

test("parses Retell agent and user utterances", () => {
  assert.deepEqual(
    parseRetellTranscript({
      transcript: [
        { role: "agent", content: "Hello" },
        { role: "user", content: "Hi there" },
      ],
    }),
    [
      { role: "assistant", text: "Hello" },
      { role: "user", text: "Hi there" },
    ],
  );
});

test("reconciles rolling windows without duplicating turns", () => {
  const first = [
    { role: "assistant" as const, text: "Hello" },
    { role: "user" as const, text: "I need help" },
  ];
  const second = [
    { role: "user" as const, text: "I need help" },
    { role: "assistant" as const, text: "Of course" },
  ];
  assert.deepEqual(reconcileRetellTranscript(first, second), [
    ...first,
    second[1],
  ]);
});

test("replaces a growing active utterance", () => {
  assert.deepEqual(
    reconcileRetellTranscript(
      [{ role: "user", text: "I need" }],
      [{ role: "user", text: "I need help" }],
    ),
    [{ role: "user", text: "I need help" }],
  );
});

test("describes token and microphone failures", () => {
  assert.match(describeRetellError("access token expired"), /token expired/i);
  assert.match(describeRetellError("microphone permission denied"), /microphone/i);
});

test("normalizes audio samples to a meter level", () => {
  assert.equal(audioLevel(new Float32Array()), 0);
  assert.ok(audioLevel(new Float32Array([0.25, -0.25])) > 0);
});
