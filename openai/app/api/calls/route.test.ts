import assert from "node:assert/strict";
import test from "node:test";
import { cloneTemplate } from "../../assistant-config.ts";
import { createCallHandler } from "./handler.ts";

const validSdp = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=relay\r\nt=0 0\r\n";

function request(body: unknown) {
  return new Request("http://localhost/api/calls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("validates SDP and assistant configuration before calling OpenAI", async () => {
  let called = false;
  const response = await createCallHandler(
    request({ sdp: "invalid", assistant: cloneTemplate("general") }),
    {
      apiKey: "key",
      fetcher: async () => {
        called = true;
        return new Response();
      },
    },
  );
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("creates a unified WebRTC call without exposing the API key", async () => {
  let sentSdp = "";
  let sentSession = "";
  const response = await createCallHandler(
    request({ sdp: validSdp, assistant: cloneTemplate("support", "cedar") }),
    {
      apiKey: "super-secret",
      fetcher: async (_url, init) => {
        const upstreamBody = init?.body as FormData;
        sentSdp = String(upstreamBody.get("sdp"));
        sentSession = String(upstreamBody.get("session"));
        return new Response(validSdp, {
          status: 201,
          headers: {
            "Content-Type": "application/sdp",
            Location: "/v1/realtime/calls/call_123",
          },
        });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(sentSdp, validSdp);
  assert.equal(sentSdp.endsWith("\r\n"), true);
  const session = JSON.parse(sentSession);
  assert.equal(session.model, "gpt-realtime-2.1");
  assert.equal(session.audio.output.voice, "cedar");
  const json = JSON.stringify(await response.json());
  assert.match(json, /call_123/);
  assert.doesNotMatch(json, /super-secret/);
});

test("normalizes OpenAI authentication failures", async () => {
  const response = await createCallHandler(
    request({ sdp: validSdp, assistant: cloneTemplate("general") }),
    {
      apiKey: "bad",
      fetcher: async () =>
        Response.json(
          { error: { message: "Incorrect API key provided" } },
          { status: 401 },
        ),
    },
  );
  assert.equal(response.status, 401);
  assert.match(JSON.stringify(await response.json()), /Incorrect API key/);
});
