import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRetellAgentPayload,
  buildRetellLlmPayload,
  cloneTemplate,
  validateAssistantForm,
} from "./assistant-config.ts";

test("clones templates without sharing editable state", () => {
  const first = cloneTemplate("support", "retell-Cimo");
  const second = cloneTemplate("support", "retell-Cimo");
  first.systemPrompt = "Changed locally";
  assert.notEqual(first.systemPrompt, second.systemPrompt);
});

test("validates and trims an assistant form", () => {
  const result = validateAssistantForm({
    ...cloneTemplate("sales", "retell-Cimo"),
    name: "  Demo seller  ",
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "Demo seller");
    assert.equal(result.value.voiceId, "retell-Cimo");
  }
});

test("rejects missing or malformed voice IDs and short prompts", () => {
  assert.deepEqual(validateAssistantForm(cloneTemplate("general")), {
    ok: false,
    error: "Select a supported Retell voice.",
  });
  assert.deepEqual(
    validateAssistantForm({ ...cloneTemplate("general", "bad voice"), systemPrompt: "short" }),
    { ok: false, error: "System prompt must be 20–10,000 characters." },
  );
});

test("builds Retell LLM and voice-agent payloads", () => {
  const form = cloneTemplate("appointments", "retell-Cimo");
  const llm = buildRetellLlmPayload(form);
  const agent = buildRetellAgentPayload(form, "llm-123");
  assert.equal(llm.model, "gpt-4.1-mini");
  assert.equal(llm.general_prompt, form.systemPrompt);
  assert.equal(llm.begin_message, form.firstMessage);
  assert.equal(agent.response_engine.llm_id, "llm-123");
  assert.equal(agent.voice_id, "retell-Cimo");
});
