import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVapiAssistantPayload,
  cloneTemplate,
  validateAssistantForm,
} from "./assistant-config.ts";

test("clones templates without sharing editable state", () => {
  const first = cloneTemplate("support");
  const second = cloneTemplate("support");
  first.systemPrompt = "Changed locally";

  assert.notEqual(first.systemPrompt, second.systemPrompt);
  assert.equal(second.templateId, "support");
});

test("validates and trims an assistant form", () => {
  const result = validateAssistantForm({
    ...cloneTemplate("sales", "Savannah"),
    name: "  Demo seller  ",
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "Demo seller");
    assert.equal(result.value.voiceId, "Savannah");
  }
});

test("rejects unsupported voices and short prompts", () => {
  assert.deepEqual(
    validateAssistantForm({ ...cloneTemplate("general"), voiceId: "custom" }),
    { ok: false, error: "Select a supported Vapi voice." },
  );
  assert.deepEqual(
    validateAssistantForm({ ...cloneTemplate("general"), voiceId: "Kylie" }),
    { ok: false, error: "Select a supported Vapi voice." },
  );
  assert.deepEqual(
    validateAssistantForm({ ...cloneTemplate("general"), systemPrompt: "short" }),
    { ok: false, error: "System prompt must be 20–10,000 characters." },
  );
});

test("builds the saved Vapi assistant payload", () => {
  const payload = buildVapiAssistantPayload(
    cloneTemplate("appointments", "Emma"),
  );

  assert.equal(payload.model.model, "gpt-4.1-mini");
  assert.equal(payload.transcriber.model, "nova-3");
  assert.equal(payload.voice.voiceId, "Emma");
  assert.equal(payload.voice.version, 2);
  assert.deepEqual(payload.clientMessages, [
    "transcript",
    "status-update",
    "speech-update",
  ]);
});

test("omits Vapi voice v2 for voices that do not support it", () => {
  const payload = buildVapiAssistantPayload(cloneTemplate("general", "Rohan"));

  assert.equal("version" in payload.voice, false);
});
