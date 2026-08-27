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

test("requires the server-only private key", async () => {
  const response = await createAssistantHandler(request(cloneTemplate("general")), {
    privateKey: "",
  });

  assert.equal(response.status, 500);
  assert.match(JSON.stringify(await response.json()), /VAPI_PRIVATE_KEY/);
});

test("rejects malformed JSON", async () => {
  const response = await createAssistantHandler(
    new Request("http://localhost/api/assistants", {
      method: "POST",
      body: "{not-json",
    }),
    { privateKey: "private-key" },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Request body must be valid JSON.",
  });
});

test("rejects invalid assistant input before calling Vapi", async () => {
  let called = false;
  const response = await createAssistantHandler(
    request({ ...cloneTemplate("general"), voiceId: "unknown" }),
    {
      privateKey: "private-key",
      fetcher: async () => {
        called = true;
        return new Response();
      },
    },
  );

  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("forwards safe validation errors from Vapi", async () => {
  const response = await createAssistantHandler(request(cloneTemplate("support")), {
    privateKey: "private-key",
    fetcher: async () =>
      Response.json({ message: "Invalid provider configuration" }, { status: 400 }),
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid provider configuration",
  });
});

test("creates an assistant without returning private data", async () => {
  let authorization = "";
  let sentBody: Record<string, unknown> = {};
  const response = await createAssistantHandler(
    request(cloneTemplate("sales", "Rohan")),
    {
      privateKey: "test-private-key",
      fetcher: async (_url, init) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? "";
        sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json(
          {
            id: "assistant-123",
            name: "Studio Sales Guide",
            createdAt: "2026-08-12T12:00:00.000Z",
            orgId: "private-org",
          },
          { status: 201 },
        );
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal(authorization, "Bearer test-private-key");
  assert.equal((sentBody.voice as { voiceId: string }).voiceId, "Rohan");

  const json = JSON.stringify(await response.json());
  assert.match(json, /assistant-123/);
  assert.doesNotMatch(json, /super-secret|private-org/);
});
