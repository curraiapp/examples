import assert from "node:assert/strict";
import test from "node:test";
import type { CurraiEvent } from "../../../../lib/currai.ts";
import { captureVoiceHandler } from "./handler.ts";

const ids = {
  session: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  boundary: "33333333-3333-4333-8333-333333333333",
};

function request(body: unknown) {
  return new Request("http://localhost/api/currai/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function capture(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: ids.session,
    userId: ids.user,
    boundaryEventId: ids.boundary,
    agentId: "agent-123",
    callId: "call-123",
    startedAt: 1_000,
    endedAt: 2_000,
    success: true,
    transcript: [
      { role: "user", text: "Browser fallback question" },
      { role: "assistant", text: "Browser fallback answer" },
    ],
    ...overrides,
  };
}

test("rejects invalid or sensitive client capture data", async () => {
  let sessionCalled = false;
  const response = await captureVoiceHandler(
    request(capture({ accessToken: "must-not-be-accepted" })),
    {
      captureSession: async () => { sessionCalled = true; return true; },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(sessionCalled, false);
});

test("prefers the completed Retell transcript and preserves event nesting", async () => {
  const order: string[] = [];
  const events: CurraiEvent[] = [];
  const response = await captureVoiceHandler(request(capture()), {
    retellApiKey: "retell-secret",
    fetcher: async (_url, init) => {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer retell-secret");
      return Response.json({
        transcript_object: [
          { role: "user", content: "Authoritative question" },
          { role: "agent", content: "Authoritative answer" },
        ],
      });
    },
    captureSession: async (session) => {
      order.push(`session:${session.sessionId}`);
      return true;
    },
    captureEvent: async (event) => {
      order.push(`event:${event.kind}`);
      events.push(event);
      return true;
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(order, [
    `session:${ids.session}`,
    "event:event",
    "event:agent",
    "event:model",
  ]);
  assert.equal(events[0].name, "retell.voice_call");
  assert.deepEqual(events[1].args, { input: "Authoritative question" });
  assert.deepEqual(events[1].result, { output: "Authoritative answer" });
  assert.equal(events[2].parentId, events[1].eventId);
  assert.equal(events[1].metadata?.provider, "retell");
  assert.equal(events[2].metadata?.provider, "openai");
  assert.equal(events[2].metadata?.model, "gpt-4.1-mini");
  assert.equal((await response.json() as { transcriptSource: string }).transcriptSource, "retell-call");
});

test("falls back to the browser transcript when Retell is not ready", async () => {
  const events: CurraiEvent[] = [];
  const response = await captureVoiceHandler(request(capture()), {
    retellApiKey: "key",
    fetcher: async () => Response.json({ call_status: "ended" }),
    captureSession: async () => true,
    captureEvent: async (event) => { events.push(event); return true; },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(events[1].args, { input: "Browser fallback question" });
  assert.equal(events[1].metadata?.transcriptSource, "browser-fallback");
});

test("returns a retryable response when Currai rejects a required event", async () => {
  const response = await captureVoiceHandler(request(capture({ callId: undefined })), {
    captureSession: async () => true,
    captureEvent: async (event) => event.kind !== "agent",
  });
  assert.equal(response.status, 503);
});
