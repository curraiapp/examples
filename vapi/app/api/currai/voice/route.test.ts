import assert from "node:assert/strict";
import test from "node:test";
import type { CurraiEvent } from "../../../../lib/currai.ts";
import { captureVoiceHandler } from "./handler.ts";

const ids = {
  session: "11111111-1111-4111-8111-111111111111",
  user: "22222222-2222-4222-8222-222222222222",
  boundary: "33333333-3333-4333-8333-333333333333",
  agent: "44444444-4444-4444-8444-444444444444",
  model: "55555555-5555-4555-8555-555555555555",
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
    assistantId: "assistant-123",
    callId: "call-123",
    startedAt: 1_000,
    endedAt: 2_000,
    success: true,
    transcript: [
      {
        role: "user",
        text: "I need help changing my delivery address.",
        agentEventId: ids.agent,
        modelEventId: ids.model,
      },
      {
        role: "assistant",
        text: "I can help with that.",
        agentEventId: "66666666-6666-4666-8666-666666666666",
        modelEventId: "77777777-7777-4777-8777-777777777777",
      },
    ],
    ...overrides,
  };
}

test("rejects invalid client capture data before ingestion", async () => {
  let sessionCalled = false;
  const response = await captureVoiceHandler(request(capture({ sessionId: "bad" })), {
    captureSession: async () => {
      sessionCalled = true;
      return true;
    },
  });

  assert.equal(response.status, 400);
  assert.equal(sessionCalled, false);
});

test("creates the session before a boundary, agent, and nested model event", async () => {
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
  assert.deepEqual(order, [
    `session:${ids.session}`,
    "event:event",
    "event:agent",
    "event:model",
  ]);
  assert.equal(events[1].eventId, ids.agent);
  assert.deepEqual(events[1].args, {
    input: "I need help changing my delivery address.",
  });
  assert.deepEqual(events[1].result, { output: "I can help with that." });
  assert.equal(events[2].parentId, ids.agent);
  assert.deepEqual(events[2].args, events[1].args);
  assert.deepEqual(events[2].result, events[1].result);
});

test("returns a retryable response when Currai rejects a required event", async () => {
  const response = await captureVoiceHandler(request(capture()), {
    captureSession: async () => true,
    captureEvent: async (event) => event.kind !== "agent",
  });

  assert.equal(response.status, 503);
});
