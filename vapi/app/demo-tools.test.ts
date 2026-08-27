import assert from "node:assert/strict";
import test from "node:test";
import {
  parseRefundDemoToolCalls,
  redactRefundDemoToolArgs,
  refundDemoToolResult,
  refundDemoTools,
} from "./demo-tools.ts";

test("builds transient Vapi tools that all use the deterministic refund backend", () => {
  const tools = refundDemoTools("https://voice-demo.example/api/vapi/tools");

  assert.deepEqual(
    tools.map((tool) => tool.function.name),
    [
      "verify_customer_identity",
      "lookup_order",
      "verify_duplicate_charge",
      "request_refund",
    ],
  );
  assert.ok(
    tools.every(
      (tool) =>
        tool.server.url === "https://voice-demo.example/api/vapi/tools" &&
        tool.async === false,
    ),
  );
});

test("verifies the synthetic demo identity and redacts its captured arguments", () => {
  const args = {
    fullName: "Yasser Ameur El Idrissi",
    email: "yasser.demo@currai.app",
    accountNumber: "ACC-2048",
  };

  assert.deepEqual(refundDemoToolResult("verify_customer_identity", args), {
    verified: true,
    customerId: "CUS-1007",
    firstName: "Yasser",
    accountNumberLast4: "2048",
    message: "Customer identity verified successfully.",
  });
  assert.deepEqual(
    redactRefundDemoToolArgs("verify_customer_identity", args),
    {
      fullName: "[REDACTED]",
      email: "[REDACTED]",
      accountNumber: "***2048",
    },
  );
});

test("returns transport success while the refund still requires manual review", () => {
  assert.deepEqual(
    refundDemoToolResult("request_refund", {
      orderId: "4821",
      chargeId: "ch_dup_4821",
      amount: 79,
    }),
    {
      requestId: "REF-8472",
      orderId: "4821",
      chargeId: "ch_dup_4821",
      amount: 79,
      currency: "USD",
      status: "requires_manual_review",
      refunded: false,
      message: "A billing specialist must approve this refund request.",
    },
  );
});

test("parses only supported Vapi refund tool calls", () => {
  const calls = parseRefundDemoToolCalls({
    type: "tool-calls",
    toolCallList: [
      {
        id: "call-1",
        function: {
          name: "request_refund",
          arguments:
            '{"orderId":"4821","chargeId":"ch_dup_4821","amount":79}',
        },
      },
      {
        id: "call-2",
        function: { name: "charge_card", arguments: "{}" },
      },
    ],
  });

  assert.deepEqual(calls, [
    {
      toolCallId: "call-1",
      name: "request_refund",
      args: {
        orderId: "4821",
        chargeId: "ch_dup_4821",
        amount: 79,
      },
    },
  ]);
});
