#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  argument,
  captureEvent,
  captureSession,
  hasFlag,
  normalizeBaseUrl,
} from "./lib/currai.mjs";

export async function runDemo({
  publicKey,
  secretKey,
  baseUrl,
  fetchImpl = fetch,
}) {
  if (!publicKey) throw new Error("--public-key is required");
  if (!secretKey) throw new Error("--secret-key is required");
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const options = {
    publicKey,
    secretKey,
    baseUrl: normalizedBaseUrl,
    fetchImpl,
  };
  const sessionId = randomUUID();
  const session = await captureSession(options, {
    session_id: sessionId,
    user_data: {
      user_id: "currai-skill-demo-user",
      properties: { source: "currai-skill-demo" },
    },
    metadata: {
      source: "currai-skill-demo",
      environment: "setup",
    },
    client_config: "currai-skill-demo",
  });

  if (!session.ok) {
    return {
      ok: false,
      baseUrl: normalizedBaseUrl,
      sessionId,
      session,
      error: "capture-session was not accepted",
    };
  }

  const parentId = randomUUID();
  const events = [];
  events.push(
    await captureEvent(options, {
      event_id: parentId,
      session_id: sessionId,
      kind: "agent",
      primitive_name: "currai-skill-demo-agent",
      args: { message: "Check the Currai integration" },
      result: { status: "completed" },
      success: true,
      latency: 42,
      metadata: { source: "currai-skill-demo", environment: "setup" },
    }),
  );
  events.push(
    await captureEvent(options, {
      session_id: sessionId,
      parent_id: parentId,
      kind: "model",
      primitive_name: "currai-skill-demo-model",
      args: { prompt: "Return a setup acknowledgement" },
      result: { text: "Currai setup event accepted" },
      success: true,
      latency: 24,
      metadata: {
        source: "currai-skill-demo",
        environment: "setup",
        model: "demo-model",
        provider: "currai-skill",
      },
    }),
  );
  events.push(
    await captureEvent(options, {
      session_id: sessionId,
      parent_id: parentId,
      kind: "tool",
      primitive_name: "currai-skill-connectivity-check",
      args: { source: "currai-skill-demo" },
      result: { connected: true },
      success: true,
      latency: 5,
      metadata: { source: "currai-skill-demo", environment: "setup" },
    }),
  );
  events.push(
    await captureEvent(options, {
      session_id: sessionId,
      parent_id: parentId,
      kind: "guardrail",
      primitive_name: "currai-skill-demo-guardrail",
      args: { check: "demo-data-only" },
      result: { allowed: true },
      success: true,
      latency: 2,
      metadata: { source: "currai-skill-demo", environment: "setup" },
    }),
  );
  events.push(
    await captureEvent(options, {
      session_id: sessionId,
      parent_id: parentId,
      kind: "evaluator",
      primitive_name: "currai-skill-demo-evaluator",
      args: { criterion: "connectivity" },
      result: { score: 1, label: "accepted" },
      success: true,
      latency: 3,
      metadata: { source: "currai-skill-demo", environment: "setup" },
    }),
  );

  const ok = events.every((event) => event.ok);
  return {
    ok,
    baseUrl: normalizedBaseUrl,
    sessionId,
    session: { ok: session.ok, status: session.status },
    events: events.map((event) => ({
      eventId: event.eventId,
      ok: event.ok,
      status: event.status,
    })),
    note: "Connectivity only. Trigger a real application interaction before calling the integration complete.",
  };
}

async function main() {
  const publicKey = argument("public-key", process.env.CURRAI_PUBLIC_KEY);
  const secretKey = argument("secret-key", process.env.CURRAI_SECRET_KEY);
  const baseUrl = normalizeBaseUrl(
    argument(
      "base-url",
      process.env.CURRAI_BASE_URL ?? "https://www.currai.app",
    ),
  );
  const json = hasFlag("json");
  try {
    const value = await runDemo({ publicKey, secretKey, baseUrl });
    print(value, json);
    if (!value.ok) process.exitCode = 1;
  } catch (error) {
    print(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      json,
    );
    process.exitCode = 1;
  }
}

function print(value, json) {
  if (json) {
    console.log(JSON.stringify(value));
    return;
  }
  if (!value.ok) {
    console.error(`error: ${value.error ?? "Currai demo failed"}`);
    return;
  }
  console.log(`connected: ${value.baseUrl}`);
  console.log(`session:   ${value.sessionId}`);
  console.log(value.note);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
