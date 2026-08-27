import {
  buildRealtimeSession,
  validateAssistantForm,
} from "../../assistant-config.ts";

const MAX_SDP_LENGTH = 128_000;

type Fetcher = typeof fetch;
type HandlerOptions = { apiKey?: string; fetcher?: Fetcher };

function safeUpstreamError(status: number, body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: unknown } | string;
      message?: unknown;
    };
    if (
      parsed.error &&
      typeof parsed.error === "object" &&
      typeof parsed.error.message === "string"
    ) {
      return parsed.error.message;
    }
    if (typeof parsed.error === "string") return parsed.error;
    if (typeof parsed.message === "string") return parsed.message;
  } catch {
    // Do not return an arbitrary HTML or proxy response to the browser.
  }
  if (status === 401 || status === 403) {
    return "OpenAI rejected OPENAI_API_KEY. Update .env.local and restart the app.";
  }
  if (status === 429) {
    return "OpenAI rate-limited the Realtime call. Wait briefly and try again.";
  }
  return "OpenAI could not create the Realtime call.";
}

function callIdFromLocation(location: string | null) {
  if (!location) return undefined;
  try {
    const value = new URL(location, "https://api.openai.com").pathname
      .split("/")
      .filter(Boolean)
      .at(-1);
    return value && /^[A-Za-z0-9_-]{2,256}$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function createCallHandler(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Add it to .env.local and restart the app.",
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

  if (!input || typeof input !== "object") {
    return Response.json({ error: "Call input is invalid." }, { status: 400 });
  }
  const candidate = input as Record<string, unknown>;
  const sdp = typeof candidate.sdp === "string" ? candidate.sdp : "";
  const validatedSdp = sdp.trim();
  if (
    validatedSdp.length < 20 ||
    sdp.length > MAX_SDP_LENGTH ||
    !validatedSdp.startsWith("v=0")
  ) {
    return Response.json(
      { error: "A valid WebRTC SDP offer is required." },
      { status: 400 },
    );
  }
  const validation = validateAssistantForm(candidate.assistant);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(buildRealtimeSession(validation.value)));

  let upstream: Response;
  try {
    upstream = await (options.fetcher ?? fetch)(
      "https://api.openai.com/v1/realtime/calls",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        cache: "no-store",
      },
    );
  } catch {
    return Response.json(
      { error: "Could not reach OpenAI. Check your network and try again." },
      { status: 502 },
    );
  }

  const answerSdp = await upstream.text();
  if (!upstream.ok) {
    return Response.json(
      { error: safeUpstreamError(upstream.status, answerSdp) },
      { status: upstream.status >= 500 ? 502 : upstream.status },
    );
  }
  if (!answerSdp.startsWith("v=0")) {
    return Response.json(
      { error: "OpenAI returned an invalid WebRTC answer." },
      { status: 502 },
    );
  }

  return Response.json({
    sdp: answerSdp,
    ...(callIdFromLocation(upstream.headers.get("location"))
      ? { callId: callIdFromLocation(upstream.headers.get("location")) }
      : {}),
  });
}
