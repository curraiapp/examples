type MicrophoneAccess = Pick<MediaDevices, "getUserMedia">;

type TranscriptTurn = {
  role: "user" | "assistant";
  text: string;
};

export type TranscriptMessage = TranscriptTurn & {
  transcriptType: "partial" | "final";
};

type AudioPlayer = Pick<HTMLMediaElement, "muted" | "volume" | "play">;

export const VAPI_DAILY_CONFIG = {
  alwaysIncludeMicInPermissionPrompt: true,
} as const;

export function vapiDailyCallObject(audioTrack: MediaStreamTrack) {
  return {
    audioSource: audioTrack,
    startAudioOff: false,
  } as const;
}

export type AudioPlaybackResult = {
  found: number;
  playing: number;
  error: string | null;
};

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

export function isDailyPostCallEjection(error: unknown) {
  return (
    getErrorMessage(error)?.includes("Meeting ended due to ejection") ?? false
  );
}

export function isDuplicateTranscriptTurn(
  turns: readonly TranscriptTurn[],
  nextTurn: TranscriptTurn,
) {
  const previousTurn = turns.at(-1);
  return (
    previousTurn?.role === nextTurn.role &&
    previousTurn.text.trim() === nextTurn.text.trim()
  );
}

export function parseTranscriptMessage(message: unknown): TranscriptMessage | null {
  if (!message || typeof message !== "object") return null;

  const candidate = message as Record<string, unknown>;
  const isTranscript =
    candidate.type === "transcript" ||
    (typeof candidate.type === "string" &&
      candidate.type.startsWith("transcript["));
  const role = candidate.role;
  const text = candidate.transcript;

  if (
    !isTranscript ||
    (role !== "user" && role !== "assistant") ||
    typeof text !== "string" ||
    !text.trim()
  ) {
    return null;
  }

  return {
    role,
    text: text.trim(),
    transcriptType:
      candidate.transcriptType === "partial" ? "partial" : "final",
  };
}

export async function resumeAudioPlayback(
  players: readonly AudioPlayer[],
): Promise<AudioPlaybackResult> {
  if (players.length === 0) {
    return { found: 0, playing: 0, error: null };
  }

  const results = await Promise.allSettled(
    players.map((player) => {
      player.muted = false;
      player.volume = 1;
      return player.play();
    }),
  );
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  return {
    found: players.length,
    playing: results.filter((result) => result.status === "fulfilled").length,
    error: rejected ? getErrorMessage(rejected.reason) : null,
  };
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
    const stream = await mediaDevices.getUserMedia({ audio: true });
    if (stream.getAudioTracks().length === 0) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("The selected microphone did not provide an audio track.");
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

export function getCallEndedReason(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;

  const candidate = message as Record<string, unknown>;
  if (candidate.type !== "status-update" || candidate.status !== "ended") {
    return null;
  }

  if (typeof candidate.endedReason === "string") {
    return candidate.endedReason;
  }

  if (candidate.call && typeof candidate.call === "object") {
    const call = candidate.call as Record<string, unknown>;
    if (typeof call.endedReason === "string") return call.endedReason;
  }

  return null;
}

export function describeEndedReason(reason: string): string | null {
  if (reason === "customer-ended-call") return null;
  if (reason === "customer-did-not-give-microphone-permission") {
    return "Vapi could not use the microphone. Allow microphone access for this site, then try again.";
  }
  if (reason === "assistant-not-found") {
    return "Vapi could not find this assistant. Check the assistant ID and public key workspace.";
  }
  if (reason === "assistant-not-valid") {
    return "This Vapi assistant configuration is invalid. Open the assistant in Vapi and resolve its validation errors.";
  }
  if (reason === "assistant-join-timed-out") {
    return "The Vapi assistant did not join in time. Check its model, voice, and provider configuration, then retry.";
  }

  return "Vapi ended the call (" + reason + "). Check this call in Vapi Observe → Logs for details.";
}

export function getVapiPublicKeyError(value: string): string | null {
  const key = value.trim();
  if (!key) {
    return "Add NEXT_PUBLIC_VAPI_PUBLIC_KEY to .env before testing calls.";
  }

  const normalized = key.toLowerCase();
  if (
    normalized.includes("your-public-key") ||
    normalized.includes("your_public_key") ||
    normalized.includes("replace-me") ||
    normalized.includes("placeholder")
  ) {
    return "NEXT_PUBLIC_VAPI_PUBLIC_KEY is still a placeholder. Copy the Public API Key from Vapi Dashboard → API Keys, update .env, and restart the app.";
  }

  return null;
}

export function describeVapiStartError(message: string): string {
  if (
    /invalid key/i.test(message) ||
    /private key instead of the public key/i.test(message) ||
    /unauthorized/i.test(message)
  ) {
    return "Vapi rejected NEXT_PUBLIC_VAPI_PUBLIC_KEY. Copy the Public API Key from Vapi Dashboard → API Keys, update .env, and restart the app.";
  }

  return message;
}
