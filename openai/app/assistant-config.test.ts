import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRealtimeSession,
  cloneTemplate,
  OPENAI_REALTIME_MODEL,
  validateAssistantForm,
} from "./assistant-config.ts";

test("clones templates without sharing editable state", () => {
  const first = cloneTemplate("support", "cedar");
  const second = cloneTemplate("support", "cedar");
  first.systemPrompt = "Changed locally";
  assert.notEqual(first.systemPrompt, second.systemPrompt);
});

test("validates and trims an assistant configuration", () => {
  const result = validateAssistantForm({
    ...cloneTemplate("sales", "coral"),
    name: "  Demo seller  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "Demo seller");
    assert.equal(result.value.voiceId, "coral");
  }
});

test("rejects unknown voices and invalid prompts", () => {
  assert.deepEqual(
    validateAssistantForm({ ...cloneTemplate("general"), voiceId: "unknown" }),
    { ok: false, error: "Select a supported OpenAI voice." },
  );
  assert.deepEqual(
    validateAssistantForm({
      ...cloneTemplate("general"),
      systemPrompt: "short",
    }),
    { ok: false, error: "System prompt must be 20–10,000 characters." },
  );
});

test("builds the OpenAI Realtime session payload", () => {
  const form = cloneTemplate("appointments", "marin");
  const session = buildRealtimeSession(form);
  assert.equal(session.model, OPENAI_REALTIME_MODEL);
  assert.equal(session.instructions, form.systemPrompt);
  assert.equal(session.audio.output.voice, "marin");
  assert.equal(session.audio.input.turn_detection.create_response, true);
  assert.equal(session.output_modalities[0], "audio");
});
