import { isRetellId } from "../../assistant-config.ts";

type Fetcher = typeof fetch;

type HandlerOptions = {
  apiKey?: string;
  fetcher?: Fetcher;
};

type CallResponse = {
  access_token?: unknown;
  call_id?: unknown;
  message?: unknown;
  error?: unknown;
};

export async function createCallHandler(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const apiKey = options.apiKey ?? process.env.RETELL_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "RETELL_API_KEY is not configured. Add it to .env.local and restart the app.",
      },
      { status: 500 },
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const agentId =
    input && typeof input === "object"
      ? (input as Record<string, unknown>).agentId
      : null;
  if (!isRetellId(agentId)) {
    return Response.json(
      { error: "A valid Retell agent ID is required." },
      { status: 400 },
    );
  }

  let upstream: Response;
  try {
    upstream = await (options.fetcher ?? fetch)(
      "https://api.retellai.com/v2/create-web-call",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agent_id: agentId }),
        cache: "no-store",
      },
    );
  } catch {
    return Response.json(
      { error: "Could not reach Retell. Check your network and try again." },
      { status: 502 },
    );
  }

  let body: CallResponse = {};
  try {
    body = (await upstream.json()) as CallResponse;
  } catch {
    // A non-JSON response is handled by the safe fallback below.
  }

  if (!upstream.ok) {
    const message =
      typeof body.message === "string" && body.message
        ? body.message
        : typeof body.error === "string" && body.error
          ? body.error
          : "Retell could not create the web call.";
    return Response.json(
      { error: message },
      { status: upstream.status >= 500 ? 502 : upstream.status },
    );
  }

  if (
    typeof body.access_token !== "string" ||
    !body.access_token ||
    typeof body.call_id !== "string" ||
    !body.call_id
  ) {
    return Response.json(
      { error: "Retell returned an invalid web-call response." },
      { status: 502 },
    );
  }

  return Response.json({
    accessToken: body.access_token,
    callId: body.call_id,
  });
}
