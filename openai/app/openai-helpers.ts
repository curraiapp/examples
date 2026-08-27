export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
  itemId: string;
};

type MicrophoneAccess = Pick<MediaDevices, "getUserMedia">;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function itemId(event: Record<string, unknown>) {
  const id = event.item_id ?? record(event.item)?.id ?? event.response_id;
  return typeof id === "string" && id ? id : crypto.randomUUID();
}

function replaceOrAppend(
  turns: readonly TranscriptTurn[],
  next: TranscriptTurn,
) {
  const index = turns.findIndex((turn) => turn.itemId === next.itemId);
  if (index >= 0) {
    const output = [...turns];
    output[index] = next;
    return output;
  }
  const previous = turns.at(-1);
  if (previous?.role === next.role && previous.text === next.text) {
    return [...turns];
  }
  return [...turns, next];
}

function completedAssistantTranscript(event: Record<string, unknown>) {
  const direct = cleanText(event.transcript ?? event.text);
  if (direct) return direct;
  const response = record(event.response);
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const candidate of output) {
    const item = record(candidate);
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const partCandidate of content) {
      const part = record(partCandidate);
      const text = cleanText(part?.transcript ?? part?.text);
      if (text) return text;
    }
  }
  return "";
}

export function applyRealtimeTranscriptEvent(
  turns: readonly TranscriptTurn[],
  value: unknown,
): TranscriptTurn[] {
  const event = record(value);
  if (!event || typeof event.type !== "string") return [...turns];

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    const text = cleanText(event.transcript);
    return text
      ? replaceOrAppend(turns, { role: "user", text, itemId: itemId(event) })
      : [...turns];
  }

  if (
    event.type === "response.output_audio_transcript.delta" ||
    event.type === "response.audio_transcript.delta"
  ) {
    const delta = typeof event.delta === "string" ? event.delta : "";
    if (!delta) return [...turns];
    const id = itemId(event);
    const existing = turns.find((turn) => turn.itemId === id);
    return replaceOrAppend(turns, {
      role: "assistant",
      text: `${existing?.text ?? ""}${delta}`.trim(),
      itemId: id,
    });
  }

  if (
    event.type === "response.output_audio_transcript.done" ||
    event.type === "response.audio_transcript.done" ||
    event.type === "response.done"
  ) {
    const text = completedAssistantTranscript(event);
    return text
      ? replaceOrAppend(turns, {
          role: "assistant",
          text,
          itemId: itemId(event),
        })
      : [...turns];
  }

  return [...turns];
}

export function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  const candidate = record(error);
  if (!candidate) return null;
  if (typeof candidate.message === "string" && candidate.message) {
    return candidate.message;
  }
  return getErrorMessage(candidate.error);
}

export function describeOpenAIError(error: unknown) {
  const message =
    getErrorMessage(error) ??
    "The OpenAI Realtime connection could not be started. Please try again.";
  if (
    /incorrect api key|unauthorized|authentication|OPENAI_API_KEY/i.test(
      message,
    )
  ) {
    return "OpenAI rejected OPENAI_API_KEY. Update .env.local and restart the app.";
  }
  if (/rate.?limit|quota|429/i.test(message)) {
    return "OpenAI rate-limited the Realtime call. Wait briefly and try again.";
  }
  if (/microphone|permission|notallowed/i.test(message)) {
    return "OpenAI could not use the microphone. Allow microphone access for this site, then try again.";
  }
  if (/SDP|peer|WebRTC|connection/i.test(message)) {
    return `The OpenAI WebRTC connection failed: ${message}`;
  }
  return message;
}

export async function ensureMicrophoneAccess(
  mediaDevices: MicrophoneAccess | undefined,
): Promise<MediaStream> {
  if (!mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser cannot access a microphone. Use a current browser on HTTPS or localhost.",
    );
  }
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(
        "The selected microphone did not provide an audio track.",
      );
    }
    return stream;
  } catch (error) {
    const name =
      error && typeof error === "object" && "name" in error
        ? String(error.name)
        : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      throw new Error(
        "Microphone access was denied. Allow microphone access for this site, then try again.",
      );
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      throw new Error(
        "No microphone was found. Connect or enable a microphone, then try again.",
      );
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      throw new Error(
        "The microphone is unavailable or already in use by another application.",
      );
    }
    if (name === "SecurityError") {
      throw new Error(
        "Microphone access requires HTTPS or a localhost development URL.",
      );
    }
    throw new Error(
      getErrorMessage(error) ??
        "The browser could not start the microphone. Check its site permissions and try again.",
    );
  }
}
