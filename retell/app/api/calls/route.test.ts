import assert from "node:assert/strict";
import test from "node:test";
import { createCallHandler } from "./handler.ts";

function request(body: unknown) {
  return new Request("http://localhost/api/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("validates the agent ID before creating a token", async () => {
  let called = false;
  const response = await createCallHandler(request({ agentId: "bad id" }), {
    apiKey: "key",
    fetcher: async () => { called = true; return new Response(); },
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("creates a one-call access token without returning the API key", async () => {
  let sentBody = "";
  const response = await createCallHandler(request({ agentId: "agent-123" }), {
    apiKey: "super-secret",
    fetcher: async (_url, init) => {
      sentBody = String(init?.body);
      return Response.json({ access_token: "short-token", call_id: "call-123", private: "hidden" }, { status: 201 });
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(sentBody), { agent_id: "agent-123" });
  const json = JSON.stringify(await response.json());
  assert.match(json, /short-token|call-123/);
  assert.doesNotMatch(json, /super-secret|hidden/);
});

test("normalizes an expired-token upstream failure", async () => {
  const response = await createCallHandler(request({ agentId: "agent-123" }), {
    apiKey: "key",
    fetcher: async () => Response.json({ message: "Access token expired" }, { status: 422 }),
  });
  assert.equal(response.status, 422);
  assert.match(JSON.stringify(await response.json()), /expired/);
});
