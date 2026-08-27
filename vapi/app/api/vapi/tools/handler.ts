import {
  parseRefundDemoToolCalls,
  refundDemoToolResult,
} from "../../../demo-tools.ts";

const MAX_BODY_BYTES = 64 * 1024;

export async function demoToolsHandler(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Tool payload is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Tool payload must be valid JSON." },
      { status: 400 },
    );
  }

  const message =
    body && typeof body === "object" && "message" in body
      ? (body as { message?: unknown }).message
      : body;
  const calls = parseRefundDemoToolCalls(message);
  if (calls.length === 0) {
    return Response.json(
      { error: "No supported refund tool call was provided." },
      { status: 400 },
    );
  }

  return Response.json({
    results: calls.map((call) => ({
      name: call.name,
      toolCallId: call.toolCallId,
      result: JSON.stringify(refundDemoToolResult(call.name, call.args)),
    })),
  });
}
