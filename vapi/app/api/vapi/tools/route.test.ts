import assert from "node:assert/strict";
import test from "node:test";
import { demoToolsHandler } from "./handler.ts";

function request(body: unknown) {
  return new Request("http://localhost/api/vapi/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns deterministic results in Vapi's tool response format", async () => {
  const response = await demoToolsHandler(
    request({
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "tool-call-123",
            function: {
              name: "request_refund",
              arguments:
                '{"orderId":"4821","chargeId":"ch_dup_4821","amount":79}',
            },
          },
        ],
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    results: { name: string; toolCallId: string; result: string }[];
  };
  assert.equal(body.results[0]?.name, "request_refund");
  assert.equal(body.results[0]?.toolCallId, "tool-call-123");
  assert.deepEqual(JSON.parse(body.results[0]!.result), {
    requestId: "REF-8472",
    orderId: "4821",
    chargeId: "ch_dup_4821",
    amount: 79,
    currency: "USD",
    status: "requires_manual_review",
    refunded: false,
    message: "A billing specialist must approve this refund request.",
  });
});

test("rejects unsupported tool calls", async () => {
  const response = await demoToolsHandler(
    request({
      message: {
        type: "tool-calls",
        toolCallList: [
          {
            id: "tool-call-123",
            function: { name: "charge_card", arguments: "{}" },
          },
        ],
      },
    }),
  );

  assert.equal(response.status, 400);
});
