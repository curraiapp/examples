export const REFUND_DEMO_TEMPLATE_IDS = [
  "refund_failure",
  "refund_fixed",
] as const;

export type RefundDemoTemplateId = (typeof REFUND_DEMO_TEMPLATE_IDS)[number];

export type RefundDemoToolName =
  | "verify_customer_identity"
  | "lookup_order"
  | "verify_duplicate_charge"
  | "request_refund";

export type DemoToolCall = {
  toolCallId: string;
  name: RefundDemoToolName;
  args: Record<string, unknown>;
};

const TOOL_NAMES = new Set<RefundDemoToolName>([
  "verify_customer_identity",
  "lookup_order",
  "verify_duplicate_charge",
  "request_refund",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 256)
    : fallback;
}

function parseArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isRefundDemoTemplate(
  templateId: string,
): templateId is RefundDemoTemplateId {
  return (REFUND_DEMO_TEMPLATE_IDS as readonly string[]).includes(templateId);
}

export function refundDemoTools(serverUrl: string) {
  const server = { url: serverUrl, timeoutSeconds: 10 };
  return [
    {
      type: "function" as const,
      async: false,
      server,
      function: {
        name: "verify_customer_identity",
        description:
          "Verify the caller's identity before accessing orders or billing information.",
        parameters: {
          type: "object" as const,
          properties: {
            fullName: {
              type: "string",
              description: "The caller's full name.",
            },
            email: {
              type: "string",
              description: "The email address on the customer account.",
            },
            accountNumber: {
              type: "string",
              description: "The caller's customer account number.",
            },
          },
          required: ["fullName", "email", "accountNumber"],
        },
      },
    },
    {
      type: "function" as const,
      async: false,
      server,
      function: {
        name: "lookup_order",
        description:
          "Look up an order and its settled charges before investigating a billing problem.",
        parameters: {
          type: "object" as const,
          properties: {
            orderId: {
              type: "string",
              description: "The caller's order number, for example 4821.",
            },
          },
          required: ["orderId"],
        },
      },
    },
    {
      type: "function" as const,
      async: false,
      server,
      function: {
        name: "verify_duplicate_charge",
        description:
          "Verify whether an order has a duplicate settled charge and identify the refundable charge.",
        parameters: {
          type: "object" as const,
          properties: {
            orderId: {
              type: "string",
              description: "The order number being investigated.",
            },
          },
          required: ["orderId"],
        },
      },
    },
    {
      type: "function" as const,
      async: false,
      server,
      function: {
        name: "request_refund",
        description:
          "Submit a refund request for a duplicate charge. The returned business status and refunded field determine whether money was actually refunded.",
        parameters: {
          type: "object" as const,
          properties: {
            orderId: {
              type: "string",
              description: "The affected order number.",
            },
            chargeId: {
              type: "string",
              description: "The duplicate charge identifier returned by verification.",
            },
            amount: {
              type: "number",
              description: "The duplicate charge amount to refund.",
            },
          },
          required: ["orderId", "chargeId", "amount"],
        },
      },
    },
  ];
}

export function refundDemoToolResult(
  name: RefundDemoToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const orderId = cleanString(args.orderId, "4821");
  const chargeId = cleanString(args.chargeId, "ch_dup_4821");

  if (name === "verify_customer_identity") {
    return {
      verified: true,
      customerId: "CUS-1007",
      firstName: "Yasser",
      accountNumberLast4: "2048",
      message: "Customer identity verified successfully.",
    };
  }

  if (name === "lookup_order") {
    return {
      found: true,
      order: {
        orderId,
        item: "Wireless headphones",
        total: 79,
        currency: "USD",
        status: "delivered",
        settledChargeCount: 2,
      },
    };
  }

  if (name === "verify_duplicate_charge") {
    return {
      duplicateConfirmed: true,
      orderId,
      chargeId: "ch_dup_4821",
      amount: 79,
      currency: "USD",
      refundable: true,
    };
  }

  return {
    requestId: "REF-8472",
    orderId,
    chargeId,
    amount: 79,
    currency: "USD",
    status: "requires_manual_review",
    refunded: false,
    message: "A billing specialist must approve this refund request.",
  };
}

export function redactRefundDemoToolArgs(
  name: RefundDemoToolName,
  args: Record<string, unknown>,
): Record<string, unknown> {
  if (name !== "verify_customer_identity") return args;

  const accountDigits = cleanString(args.accountNumber, "").replace(/\D/g, "");
  const last4 = accountDigits.slice(-4);
  return {
    fullName: "[REDACTED]",
    email: "[REDACTED]",
    accountNumber: last4 ? `***${last4}` : "[REDACTED]",
  };
}

export function parseRefundDemoToolCalls(value: unknown): DemoToolCall[] {
  if (!isRecord(value) || value.type !== "tool-calls") return [];
  const list = Array.isArray(value.toolCallList) ? value.toolCallList : [];
  const calls: DemoToolCall[] = [];

  for (const candidate of list) {
    if (!isRecord(candidate) || !isRecord(candidate.function)) continue;
    const toolCallId = cleanString(candidate.id, "");
    const name = candidate.function.name;
    if (
      !toolCallId ||
      typeof name !== "string" ||
      !TOOL_NAMES.has(name as RefundDemoToolName)
    ) {
      continue;
    }
    calls.push({
      toolCallId,
      name: name as RefundDemoToolName,
      args: parseArguments(candidate.function.arguments),
    });
  }

  return calls;
}
