export type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
};

type MicrophoneAccess = Pick<MediaDevices, "getUserMedia">;

function normalizeRole(value: unknown): TranscriptTurn["role"] | null {
  if (value === "user") return "user";
  if (value === "agent" || value === "assistant") return "assistant";
  return null;
}

export function parseRetellTranscript(update: unknown): TranscriptTurn[] {
  if (!update || typeof update !== "object") return [];
  const transcript = (update as Record<string, unknown>).transcript;
  if (!Array.isArray(transcript)) return [];

  return transcript.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const item = candidate as Record<string, unknown>;
    const role = normalizeRole(item.role);
    const text =
      typeof item.content === "string" ? item.content.trim() : "";
    return role && text ? [{ role, text }] : [];
  });
}

function sameTurn(left: TranscriptTurn, right: TranscriptTurn) {
  return left.role === right.role && left.text === right.text;
}

export function reconcileRetellTranscript(
  current: readonly TranscriptTurn[],
  incoming: readonly TranscriptTurn[],
): TranscriptTurn[] {
  if (incoming.length === 0) return [...current];
  if (current.length === 0) return [...incoming];

  const maxOverlap = Math.min(current.length, incoming.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    const currentStart = current.length - size;
    if (
      incoming
        .slice(0, size)
        .every((turn, index) => sameTurn(current[currentStart + index], turn))
    ) {
      return [...current, ...incoming.slice(size)];
    }
  }

  // Retell revises the active utterance while retaining the preceding window.
  // Align on the stable prefix and replace the rolling window in place.
  let bestStart = -1;
  let bestMatches = 0;
  for (let start = 0; start < current.length; start += 1) {
    let matches = 0;
    const stableLength = Math.max(0, incoming.length - 1);
    while (
      matches < stableLength &&
      start + matches < current.length &&
      sameTurn(current[start + matches], incoming[matches])
    ) {
      matches += 1;
    }
    if (matches > bestMatches) {
      bestStart = start;
      bestMatches = matches;
    }
  }
  if (bestStart >= 0 && bestMatches > 0) {
    return [...current.slice(0, bestStart), ...incoming];
  }

  const previous = current.at(-1);
  const next = incoming[0];
  if (
    incoming.length === 1 &&
    previous?.role === next.role &&
    (next.text.startsWith(previous.text) || previous.text.startsWith(next.text))
  ) {
    return [...current.slice(0, -1), next];
  }

  return [...current, ...incoming];
}

export function isDuplicateTranscriptTurn(
  turns: readonly TranscriptTurn[],
  nextTurn: TranscriptTurn,
) {
  const previous = turns.at(-1);
  return previous ? sameTurn(previous, nextTurn) : false;
}

export function getErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  if (!error || typeof error !== "object") return null;
  const candidate = error as Record<string, unknown>;
  if (typeof candidate.message === "string" && candidate.message) {
    return candidate.message;
  }
  return getErrorMessage(candidate.error);
}

export function describeRetellError(error: unknown) {
  const message =
    getErrorMessage(error) ??
    "The Retell voice connection could not be started. Please try again.";
  if (/unauthorized|invalid api key|authentication/i.test(message)) {
    return "Retell rejected RETELL_API_KEY. Copy the API key from your Retell workspace, update .env.local, and restart the app.";
  }
  if (/access.?token|token.*expir/i.test(message)) {
    return "The Retell call token expired before the call connected. Start a new call and try again.";
  }
  if (/microphone|permission|notallowed/i.test(message)) {
    return "Retell could not use the microphone. Allow microphone access for this site, then try again.";
  }
  return message;
}

export async function ensureMicrophoneAccess(
  mediaDevices: MicrophoneAccess | undefined,
): Promise<void> {
  if (!mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser cannot access a microphone. Use a current browser on HTTPS or localhost.",
    );
  }
  try {
    const stream = await mediaDevices.getUserMedia({ audio: true });
    if (stream.getAudioTracks().length === 0) {
      throw new Error("The selected microphone did not provide an audio track.");
    }
    stream.getTracks().forEach((track) => track.stop());
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

export function audioLevel(samples: Float32Array) {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}
