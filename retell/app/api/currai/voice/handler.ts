import { createHash } from "node:crypto";
import {
  captureCurraiEvent,
  captureCurraiSession,
  type CurraiEvent,
} from "../../../../lib/currai.ts";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_ENTRIES = 200;
const MAX_TEXT_LENGTH = 8_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RETELL_ID_PATTERN = /^[A-Za-z0-9_-]{2,256}$/;
const SENSITIVE_KEY = /authorization|cookie|password|secret|api[-_]?key|access[-_]?token|bearer/i;

type CaptureSession = typeof captureCurraiSession;
type CaptureEvent = typeof captureCurraiEvent;
type Fetcher = typeof fetch;

type HandlerOptions = {
  captureSession?: CaptureSession;
  captureEvent?: CaptureEvent;
  retellApiKey?: string;
  fetcher?: Fetcher;
};

type TranscriptEntry = { role: "user" | "assistant"; text: string };
type VoiceCapture = {
  sessionId: string;
  userId: string;
  boundaryEventId: string;
  agentId: string;
  callId?: string;
  startedAt: number;
  endedAt: number;
  success: boolean;
  error?: string;
  transcript: TranscriptEntry[];
};

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, maxLength);
  return text || undefined;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function hasSensitiveKey(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasSensitiveKey(item, seen));
  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => SENSITIVE_KEY.test(key) || hasSensitiveKey(item, seen),
  );
}

function normalizeTranscript(value: unknown): TranscriptEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_TRANSCRIPT_ENTRIES) return null;
  const transcript: TranscriptEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const entry = candidate as Record<string, unknown>;
    const role = entry.role === "agent" ? "assistant" : entry.role;
    const text = cleanText(entry.text ?? entry.content);
    if ((role !== "user" && role !== "assistant") || !text) return null;
    transcript.push({ role, text });
  }
  return transcript;
}

function parseCapture(value: unknown): VoiceCapture | null {
  if (!value || typeof value !== "object" || hasSensitiveKey(value)) return null;
  const input = value as Record<string, unknown>;
  const transcript = normalizeTranscript(input.transcript);
  if (
    !isUuid(input.sessionId) ||
    !isUuid(input.userId) ||
    !isUuid(input.boundaryEventId) ||
    typeof input.agentId !== "string" ||
    !RETELL_ID_PATTERN.test(input.agentId) ||
    (input.callId !== undefined &&
      (typeof input.callId !== "string" || !RETELL_ID_PATTERN.test(input.callId))) ||
    typeof input.startedAt !== "number" ||
    typeof input.endedAt !== "number" ||
    typeof input.success !== "boolean" ||
    transcript === null
  ) {
    return null;
  }
  return {
    sessionId: input.sessionId,
    userId: input.userId,
    boundaryEventId: input.boundaryEventId,
    agentId: input.agentId,
    callId: input.callId as string | undefined,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    success: input.success,
    error: cleanText(input.error, 1_000),
    transcript,
  };
}

async function completedTranscript(
  capture: VoiceCapture,
  options: HandlerOptions,
): Promise<TranscriptEntry[] | null> {
  const apiKey = options.retellApiKey ?? process.env.RETELL_API_KEY?.trim();
  if (!capture.callId || !apiKey) return null;
  try {
    const response = await (options.fetcher ?? fetch)(
      `https://api.retellai.com/v2/get-call/${encodeURIComponent(capture.callId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as Record<string, unknown>;
    const transcript = normalizeTranscript(body.transcript_object);
    return transcript?.length ? transcript : null;
  } catch {
    return null;
  }
}

function coalesce(entries: TranscriptEntry[]) {
  const output: TranscriptEntry[] = [];
  for (const entry of entries) {
    const previous = output.at(-1);
    if (previous?.role === entry.role) {
      previous.text = `${previous.text} ${entry.text}`.slice(0, MAX_TEXT_LENGTH);
    } else {
      output.push({ ...entry });
    }
  }
  return output;
}

function conversationTurns(entries: TranscriptEntry[]) {
  const turns: Array<{ input?: string; output?: string }> = [];
  const normalized = coalesce(entries);
  for (let index = 0; index < normalized.length; index += 1) {
    const entry = normalized[index];
    if (entry.role === "user" && normalized[index + 1]?.role === "assistant") {
      turns.push({ input: entry.text, output: normalized[index + 1].text });
      index += 1;
    } else {
      turns.push(entry.role === "user" ? { input: entry.text } : { output: entry.text });
    }
  }
  return turns;
}

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export async function captureVoiceHandler(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "Capture payload is too large." }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const capture = parseCapture(raw);
  if (!capture) {
    return Response.json({ error: "Capture payload is invalid." }, { status: 400 });
  }

  const authoritative = await completedTranscript(capture, options);
  const transcript = authoritative ?? capture.transcript;
  const turns = conversationTurns(transcript);
  const sendSession = options.captureSession ?? captureCurraiSession;
  const sendEvent = options.captureEvent ?? captureCurraiEvent;
  const sessionAccepted = await sendSession({
    sessionId: capture.sessionId,
    userId: capture.userId,
    timestamp: capture.startedAt,
    properties: { source: "retell-web" },
    metadata: {
      route: "browser-voice-call",
      environment: process.env.NODE_ENV ?? "development",
    },
  });
  if (!sessionAccepted) {
    return Response.json({ error: "Capture service unavailable." }, { status: 503 });
  }

  const commonMetadata = {
    provider: "retell",
    route: "browser-voice-call",
    agentId: capture.agentId,
    ...(capture.callId ? { callId: capture.callId } : {}),
    transcriptSource: authoritative ? "retell-call" : "browser-fallback",
    environment: process.env.NODE_ENV ?? "development",
  };
  const events: CurraiEvent[] = [
    {
      eventId: capture.boundaryEventId,
      sessionId: capture.sessionId,
      sessionAccepted,
      kind: "event",
      name: "retell.voice_call",
      args: { agentId: capture.agentId },
      result: {
        transcriptEntries: transcript.length,
        conversationTurns: turns.length,
        ...(capture.error ? { error: capture.error } : {}),
      },
      success: capture.success,
      latency: Math.max(0, capture.endedAt - capture.startedAt),
      timestamp: capture.startedAt,
      metadata: commonMetadata,
    },
  ];

  turns.forEach((turn, index) => {
    const agentEventId = deterministicUuid(`${capture.boundaryEventId}:agent:${index}`);
    const modelEventId = deterministicUuid(`${capture.boundaryEventId}:model:${index}`);
    const evidence = {
      args: turn.input ? { input: turn.input } : {},
      result: turn.output ? { output: turn.output } : {},
    };
    events.push(
      {
        eventId: agentEventId,
        sessionId: capture.sessionId,
        sessionAccepted,
        kind: "agent",
        name: "retell.conversation.turn",
        ...evidence,
        success: capture.success,
        timestamp: capture.endedAt,
        metadata: commonMetadata,
      },
      {
        eventId: modelEventId,
        sessionId: capture.sessionId,
        sessionAccepted,
        parentId: agentEventId,
        kind: "model",
        name: "retell.model",
        ...evidence,
        success: capture.success,
        timestamp: capture.endedAt,
        metadata: { ...commonMetadata, provider: "openai", model: "gpt-4.1-mini" },
      },
    );
  });

  for (const event of events) {
    if (!(await sendEvent(event))) {
      return Response.json({ error: "Capture service unavailable." }, { status: 503 });
    }
  }
  return Response.json({
    captured: true,
    turns: turns.length,
    transcriptSource: authoritative ? "retell-call" : "browser-fallback",
  });
}
