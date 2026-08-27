import assert from "node:assert/strict";
import test from "node:test";
import type { CurraiEvent } from "../../../../lib/currai.ts";
import { captureVoiceHandler } from "./handler.ts";

const ids = {
  session: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  boundary: "33333333-3333-4333-8333-333333333333",
  assistant: "44444444-4444-4444-8444-444444444444",
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
    assistantId: ids.assistant,
    callId: "call_123",
    voiceId: "marin",
    startedAt: 1_000,
    endedAt: 2_000,
    success: true,
    transcript: [
      { role: "assistant", text: "Welcome" },
      { role: "user", text: "Can you help?" },
      { role: "assistant", text: "Absolutely" },
    ],
    ...overrides,
  };
}

test("rejects sensitive client capture data", async () => {
  let sessionCalled = false;
  const response = await captureVoiceHandler(
    request(capture({ apiKey: "must-not-be-accepted" })),
    {
      captureSession: async () => {
        sessionCalled = true;
        return true;
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(sessionCalled, false);
});

test("creates the session before readable turns and nested model events", async () => {
  const order: string[] = [];
  const events: CurraiEvent[] = [];
  const response = await captureVoiceHandler(request(capture()), {
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
  assert.equal(order[0], `session:${ids.session}`);
  assert.equal(events[0].name, "openai.realtime_call");
  assert.equal(events[1].name, "openai.conversation.turn");
  assert.deepEqual(events[1].result, { output: "Welcome" });
  assert.deepEqual(events[3].args, { input: "Can you help?" });
  assert.deepEqual(events[3].result, { output: "Absolutely" });
  assert.equal(events[2].parentId, events[1].eventId);
  assert.equal(events[4].parentId, events[3].eventId);
  assert.equal(events[4].metadata?.provider, "openai");
  assert.equal(events[4].metadata?.model, "gpt-realtime-2.1");
});

test("returns a retryable response when Currai rejects an event", async () => {
  const response = await captureVoiceHandler(request(capture()), {
    captureSession: async () => true,
    captureEvent: async (event) => event.kind !== "agent",
  });
  assert.equal(response.status, 503);
});
