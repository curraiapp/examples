import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRealtimeTranscriptEvent,
  describeOpenAIError,
  type TranscriptTurn,
} from "./openai-helpers.ts";

test("captures completed user transcription once", () => {
  const event = {
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "user-1",
    transcript: "Hello there",
  };
  const first = applyRealtimeTranscriptEvent([], event);
  const duplicate = applyRealtimeTranscriptEvent(first, event);
  assert.deepEqual(duplicate, [
    { role: "user", text: "Hello there", itemId: "user-1" },
  ]);
});

test("reconciles assistant transcript deltas with the final transcript", () => {
  let turns: TranscriptTurn[] = [];
  turns = applyRealtimeTranscriptEvent(turns, {
    type: "response.output_audio_transcript.delta",
    item_id: "assistant-1",
    delta: "Hello",
  });
  turns = applyRealtimeTranscriptEvent(turns, {
    type: "response.output_audio_transcript.delta",
    item_id: "assistant-1",
    delta: " world",
  });
  turns = applyRealtimeTranscriptEvent(turns, {
    type: "response.output_audio_transcript.done",
    item_id: "assistant-1",
    transcript: "Hello world.",
  });
  assert.deepEqual(turns, [
    { role: "assistant", text: "Hello world.", itemId: "assistant-1" },
  ]);
});

test("reads assistant evidence from response.done", () => {
  const turns = applyRealtimeTranscriptEvent([], {
    type: "response.done",
    response_id: "response-1",
    response: {
      output: [
        {
          content: [{ type: "audio", transcript: "Finished response" }],
        },
      ],
    },
  });
  assert.equal(turns[0]?.text, "Finished response");
});

test("returns readable OpenAI errors", () => {
  assert.match(
    describeOpenAIError({ message: "Rate limit exceeded" }),
    /rate-limited/i,
  );
  assert.match(
    describeOpenAIError(new Error("Incorrect API key")),
    /OPENAI_API_KEY/,
  );
});
