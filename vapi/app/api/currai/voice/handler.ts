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

type CaptureSession = typeof captureCurraiSession;
type CaptureEvent = typeof captureCurraiEvent;

type HandlerOptions = {
  captureSession?: CaptureSession;
  captureEvent?: CaptureEvent;
};

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  agentEventId: string;
  modelEventId: string;
};

type VoiceCapture = {
  sessionId: string;
  userId: string;
  boundaryEventId: string;
  assistantId: string;
  callId?: string;
  startedAt: number;
  endedAt: number;
  success: boolean;
  error?: string;
  transcript: TranscriptEntry[];
};

type ConversationTurn = {
  input?: string;
  output?: string;
  agentEventId: string;
  modelEventId: string;
};

function cleanText(value: unknown, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, maxLength);
  return text || undefined;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function parseCapture(value: unknown): VoiceCapture | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    !isUuid(input.sessionId) ||
    !isUuid(input.userId) ||
    !isUuid(input.boundaryEventId) ||
    !cleanText(input.assistantId, 256) ||
    typeof input.startedAt !== "number" ||
    typeof input.endedAt !== "number" ||
    typeof input.success !== "boolean" ||
    !Array.isArray(input.transcript) ||
    input.transcript.length > MAX_TRANSCRIPT_ENTRIES
  ) {
    return null;
  }

  const transcript: TranscriptEntry[] = [];
  for (const candidate of input.transcript) {
    if (!candidate || typeof candidate !== "object") return null;
    const entry = candidate as Record<string, unknown>;
    const text = cleanText(entry.text);
    if (
      (entry.role !== "user" && entry.role !== "assistant") ||
      !text ||
      !isUuid(entry.agentEventId) ||
      !isUuid(entry.modelEventId)
    ) {
      return null;
    }
    transcript.push({
      role: entry.role,
      text,
      agentEventId: entry.agentEventId,
      modelEventId: entry.modelEventId,
    });
  }

  return {
    sessionId: input.sessionId,
    userId: input.userId,
    boundaryEventId: input.boundaryEventId,
    assistantId: cleanText(input.assistantId, 256)!,
    callId: cleanText(input.callId, 256),
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    success: input.success,
    error: cleanText(input.error, 1_000),
    transcript,
  };
}

function conversationTurns(entries: TranscriptEntry[]): ConversationTurn[] {
  const coalesced: TranscriptEntry[] = [];
  for (const entry of entries) {
    const previous = coalesced.at(-1);
    if (previous?.role === entry.role) {
      previous.text = `${previous.text} ${entry.text}`.slice(0, MAX_TEXT_LENGTH);
    } else {
      coalesced.push({ ...entry });
    }
  }

  const turns: ConversationTurn[] = [];
  for (let index = 0; index < coalesced.length; index += 1) {
    const entry = coalesced[index];
    if (entry.role === "user" && coalesced[index + 1]?.role === "assistant") {
      turns.push({
        input: entry.text,
        output: coalesced[index + 1].text,
        agentEventId: entry.agentEventId,
        modelEventId: entry.modelEventId,
      });
      index += 1;
    } else {
      turns.push({
        ...(entry.role === "user"
          ? { input: entry.text }
          : { output: entry.text }),
        agentEventId: entry.agentEventId,
        modelEventId: entry.modelEventId,
      });
    }
  }
  return turns;
}

function eventEvidence(turn: ConversationTurn) {
  return {
    args: turn.input ? { input: turn.input } : {},
    result: turn.output ? { output: turn.output } : {},
  };
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

  const sendSession = options.captureSession ?? captureCurraiSession;
  const sendEvent = options.captureEvent ?? captureCurraiEvent;
  const sessionAccepted = await sendSession({
    sessionId: capture.sessionId,
    userId: capture.userId,
    timestamp: capture.startedAt,
    properties: { source: "vapi-web" },
    metadata: {
      route: "browser-voice-call",
      environment: process.env.NODE_ENV ?? "development",
    },
  });

  if (!sessionAccepted) {
    return Response.json({ error: "Capture service unavailable." }, { status: 503 });
  }

  const turns = conversationTurns(capture.transcript);
  const commonMetadata = {
    provider: "vapi",
    route: "browser-voice-call",
    assistantId: capture.assistantId,
    ...(capture.callId ? { callId: capture.callId } : {}),
    environment: process.env.NODE_ENV ?? "development",
  };
  const events: CurraiEvent[] = [
    {
      eventId: capture.boundaryEventId,
      sessionId: capture.sessionId,
      sessionAccepted,
      kind: "event",
      name: "vapi.voice_call",
      args: { assistantId: capture.assistantId },
      result: {
        transcriptEntries: capture.transcript.length,
        conversationTurns: turns.length,
        ...(capture.error ? { error: capture.error } : {}),
      },
      success: capture.success,
      latency: Math.max(0, capture.endedAt - capture.startedAt),
      timestamp: capture.startedAt,
      metadata: commonMetadata,
    },
  ];

  for (const turn of turns) {
    const evidence = eventEvidence(turn);
    events.push(
      {
        eventId: turn.agentEventId,
        sessionId: capture.sessionId,
        sessionAccepted,
        kind: "agent",
        name: "vapi.conversation.turn",
        ...evidence,
        success: capture.success,
        timestamp: capture.endedAt,
        metadata: commonMetadata,
      },
      {
        eventId: turn.modelEventId,
        sessionId: capture.sessionId,
        sessionAccepted,
        parentId: turn.agentEventId,
        kind: "model",
        name: "vapi.model",
        ...evidence,
        success: capture.success,
        timestamp: capture.endedAt,
        metadata: {
          ...commonMetadata,
          provider: "openai",
          model: "gpt-4.1-mini",
        },
      },
    );
  }

  for (const event of events) {
    if (!(await sendEvent(event))) {
      return Response.json({ error: "Capture service unavailable." }, { status: 503 });
    }
  }

  return Response.json({ captured: true, turns: turns.length });
}
