import assert from "node:assert/strict";
import test from "node:test";
import { listVoicesHandler } from "./handler.ts";

test("requires the server-only Retell API key", async () => {
  const response = await listVoicesHandler(new Request("http://localhost/api/voices"), { apiKey: "" });
  assert.equal(response.status, 500);
  assert.match(JSON.stringify(await response.json()), /RETELL_API_KEY/);
});

test("normalizes and sorts safe voice fields", async () => {
  let authorization = "";
  const response = await listVoicesHandler(new Request("http://localhost/api/voices"), {
    apiKey: "super-secret",
    fetcher: async (_url, init) => {
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return Response.json([
        { voice_id: "retell-Z", voice_name: "Zara", provider: "openai", gender: "female", accent: "British", preview_audio_url: "https://example.com/z.mp3", private: "hidden" },
        { voice_id: "retell-A", voice_name: "Adrian", provider: "elevenlabs", gender: "male", accent: "American" },
      ]);
    },
  });
  assert.equal(response.status, 200);
  assert.equal(authorization, "Bearer super-secret");
  const json = JSON.stringify(await response.json());
  assert.ok(json.indexOf("Adrian") < json.indexOf("Zara"));
  assert.doesNotMatch(json, /hidden|super-secret/);
});
