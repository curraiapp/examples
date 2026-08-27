import assert from "node:assert/strict";
import test from "node:test";
import { cloneTemplate } from "../../assistant-config.ts";
import { createAssistantHandler } from "./handler.ts";

function request(body: unknown) {
  return new Request("http://localhost/api/assistants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("requires the server-only OpenAI API key", async () => {
  const response = await createAssistantHandler(
    request(cloneTemplate("general")),
    { apiKey: "" },
  );
  assert.equal(response.status, 500);
  assert.match(JSON.stringify(await response.json()), /OPENAI_API_KEY/);
});

test("validates assistant input before creating a configuration", async () => {
  const response = await createAssistantHandler(
    request({ ...cloneTemplate("general"), voiceId: "not-a-voice" }),
    { apiKey: "key" },
  );
  assert.equal(response.status, 400);
});

test("returns a safe Realtime assistant configuration", async () => {
  const response = await createAssistantHandler(
    request(cloneTemplate("sales", "cedar")),
    {
      apiKey: "super-secret",
      createId: () => "11111111-1111-4111-8111-111111111111",
      now: () => new Date("2026-08-27T12:00:00.000Z"),
    },
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.assistant.configuration.model, "gpt-realtime-2.1");
  assert.equal(body.assistant.configuration.voiceId, "cedar");
  const json = JSON.stringify(body);
  assert.doesNotMatch(json, /super-secret|OPENAI_API_KEY/);
});
