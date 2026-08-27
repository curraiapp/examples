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

test("requires the server-only Retell API key", async () => {
  const response = await createAssistantHandler(request(cloneTemplate("general", "retell-Cimo")), { apiKey: "" });
  assert.equal(response.status, 500);
  assert.match(JSON.stringify(await response.json()), /RETELL_API_KEY/);
});

test("rejects invalid input before calling Retell", async () => {
  let called = false;
  const response = await createAssistantHandler(request(cloneTemplate("general")), {
    apiKey: "key",
    fetcher: async () => { called = true; return new Response(); },
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("creates an LLM then a voice agent without returning private data", async () => {
  const urls: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const response = await createAssistantHandler(request(cloneTemplate("sales", "retell-Cimo")), {
    apiKey: "super-secret",
    fetcher: async (url, init) => {
      urls.push(String(url));
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (String(url).endsWith("create-retell-llm")) return Response.json({ llm_id: "llm-123" }, { status: 201 });
      return Response.json({ agent_id: "agent-123", agent_name: "Studio Sales Guide", last_modification_timestamp: 1_700_000_000_000 }, { status: 201 });
    },
  });
  assert.equal(response.status, 201);
  assert.match(urls[0], /create-retell-llm$/);
  assert.match(urls[1], /create-agent$/);
  assert.equal((bodies[1].response_engine as { llm_id: string }).llm_id, "llm-123");
  const json = JSON.stringify(await response.json());
  assert.match(json, /agent-123|llm-123/);
  assert.doesNotMatch(json, /super-secret/);
});

test("deletes the new LLM when agent creation fails", async () => {
  const urls: string[] = [];
  const response = await createAssistantHandler(request(cloneTemplate("support", "retell-Cimo")), {
    apiKey: "key",
    fetcher: async (url) => {
      urls.push(String(url));
      if (String(url).endsWith("create-retell-llm")) return Response.json({ llm_id: "llm-orphan" }, { status: 201 });
      if (String(url).endsWith("create-agent")) return Response.json({ message: "Invalid voice" }, { status: 422 });
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(response.status, 422);
  assert.match(urls[2], /delete-retell-llm\/llm-orphan$/);
});
