"use client";

import type Vapi from "@vapi-ai/web";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSISTANT_TEMPLATES,
  cloneTemplate,
  type AssistantForm,
  type CreatedAssistant,
  type TemplateId,
  VAPI_VOICES,
  type VoiceId,
} from "./assistant-config";
import {
  describeEndedReason,
  describeVapiStartError,
  ensureMicrophoneAccess,
  getCallEndedReason,
  getErrorMessage,
  getVapiPublicKeyError,
  isDuplicateTranscriptTurn,
  parseTranscriptMessage,
  resumeAudioPlayback,
  VAPI_DAILY_CONFIG,
  vapiDailyCallObject,
} from "./vapi-helpers";

const WAVE_BARS = Array.from({ length: 28 }, (_, index) => index);

type CallState = "idle" | "connecting" | "live" | "ending" | "error";
type AudioState = "waiting" | "playing" | "blocked";
type Speaker = "user" | "assistant";

type TranscriptEntry = {
  id: string;
  role: Speaker;
  text: string;
};

type CaptureTranscriptEntry = Omit<TranscriptEntry, "id"> & {
  agentEventId: string;
  modelEventId: string;
};

type VoiceCaptureContext = {
  sessionId: string;
  userId: string;
  boundaryEventId: string;
  assistantId: string;
  callId?: string;
  startedAt: number;
  endedAt?: number;
  success: boolean;
  error?: string;
  payload?: Record<string, unknown>;
  upload?: Promise<boolean>;
};

const ANONYMOUS_USER_KEY = "currai-anonymous-user-id";

function getAnonymousUserId() {
  try {
    const stored = window.localStorage.getItem(ANONYMOUS_USER_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    window.localStorage.setItem(ANONYMOUS_USER_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function getResponseError(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const error = (value as Record<string, unknown>).error;
  return typeof error === "string" && error ? error : null;
}

function readableError(error: unknown) {
  return (
    getErrorMessage(error) ??
    "The voice connection could not be started. Please try again."
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function VoiceConsole() {
  const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY?.trim() ?? "";
  const publicKeyError = getVapiPublicKeyError(publicKey);
  const [form, setForm] = useState<AssistantForm>(() => cloneTemplate("general"));
  const [createdAssistant, setCreatedAssistant] =
    useState<CreatedAssistant | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formMessageTone, setFormMessageTone] = useState<
    "neutral" | "error" | "success"
  >("neutral");
  const [callState, setCallState] = useState<CallState>("idle");
  const [callMessage, setCallMessage] = useState<string | null>(null);
  const [diagnosticCallId, setDiagnosticCallId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [partialTranscript, setPartialTranscript] =
    useState<TranscriptEntry | null>(null);
  const [duration, setDuration] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>("waiting");
  const [audioMessage, setAudioMessage] = useState<string | null>(null);

  const vapiRef = useRef<Vapi | null>(null);
  const actionPendingRef = useRef(false);
  const startFailureRef = useRef<string | null>(null);
  const audioStateRef = useRef<AudioState>("waiting");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const remoteMeterRef = useRef<HTMLDivElement>(null);
  const localMeterRef = useRef<HTMLDivElement>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const captureTranscriptRef = useRef<CaptureTranscriptEntry[]>([]);
  const voiceCaptureRef = useRef<VoiceCaptureContext | null>(null);

  const isCallActive =
    callState === "connecting" ||
    callState === "live" ||
    callState === "ending";
  const canStartCall = Boolean(
    createdAssistant && !publicKeyError && !isCallActive,
  );

  const clearAssistantAudio = useCallback(() => {
    document
      .querySelectorAll("audio[data-participant-id]")
      .forEach((player) => player.remove());
  }, []);

  const releaseMicrophone = useCallback(() => {
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneStreamRef.current = null;
  }, []);

  const enableAssistantAudio = useCallback(async () => {
    const players = Array.from(
      document.querySelectorAll<HTMLAudioElement>(
        "audio[data-participant-id]",
      ),
    );
    const result = await resumeAudioPlayback(players);

    if (result.found === 0) {
      audioStateRef.current = "waiting";
      setAudioState("waiting");
      setAudioMessage("Waiting for the assistant audio track.");
      return;
    }

    if (result.playing === result.found) {
      audioStateRef.current = "playing";
      setAudioState("playing");
      setAudioMessage(null);
      return;
    }

    audioStateRef.current = "blocked";
    setAudioState("blocked");
    setAudioMessage(
      result.error ?? "Your browser paused the assistant. Enable sound to resume.",
    );
  }, []);

  useEffect(() => {
    return () => {
      const vapi = vapiRef.current;
      vapi?.removeAllListeners();
      void vapi?.stop();
      releaseMicrophone();
      clearAssistantAudio();
    };
  }, [clearAssistantAudio, releaseMicrophone]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      const addedAssistantAudio = mutations.some((mutation) =>
        Array.from(mutation.addedNodes).some(
          (node) =>
            node instanceof HTMLAudioElement &&
            node.matches("audio[data-participant-id]"),
        ),
      );
      if (addedAssistantAudio) void enableAssistantAudio();
    });

    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [enableAssistantAudio]);

  useEffect(() => {
    if (callState !== "live") return;
    const timer = window.setInterval(() => {
      setDuration((current) => current + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [callState]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [transcript, partialTranscript]);

  function invalidateAssistant(message = "Configuration changed. Create a new assistant to test it.") {
    setCreatedAssistant(null);
    setFormMessage(message);
    setFormMessageTone("neutral");
  }

  function updateForm<Key extends keyof AssistantForm>(
    key: Key,
    value: AssistantForm[Key],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    if (createdAssistant) invalidateAssistant();
    else setFormMessage(null);
  }

  function uploadVoiceCapture() {
    const capture = voiceCaptureRef.current;
    if (!capture) return Promise.resolve(false);
    if (capture.upload) return capture.upload;

    capture.endedAt ??= Date.now();
    capture.payload ??= {
      sessionId: capture.sessionId,
      userId: capture.userId,
      boundaryEventId: capture.boundaryEventId,
      assistantId: capture.assistantId,
      ...(capture.callId ? { callId: capture.callId } : {}),
      startedAt: capture.startedAt,
      endedAt: capture.endedAt,
      success: capture.success,
      ...(capture.error ? { error: capture.error } : {}),
      transcript: captureTranscriptRef.current,
    };

    capture.upload = (async () => {
      for (const delay of [0, 500, 1_500]) {
        if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
        try {
          const response = await fetch("/api/currai/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(capture.payload),
            keepalive: true,
          });
          if (response.ok) return true;
          if (response.status < 500 && response.status !== 429) return false;
        } catch {
          // Capture is best-effort and must never interrupt the voice call.
        }
      }
      return false;
    })();
    return capture.upload;
  }

  function selectTemplate(templateId: TemplateId) {
    setForm((current) => cloneTemplate(templateId, current.voiceId));
    invalidateAssistant("Template loaded. Edit it freely, then create your assistant.");
  }

  function selectVoice(voiceId: VoiceId) {
    updateForm("voiceId", voiceId);
  }

  async function createAssistant() {
    if (isCreating || isCallActive) return;

    setIsCreating(true);
    setFormMessage(null);
    setCreatedAssistant(null);

    try {
      const response = await fetch("/api/assistants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = (await response.json()) as unknown;
      const error = getResponseError(body);
      if (!response.ok || error) {
        throw new Error(error ?? "The assistant could not be created.");
      }

      const assistant =
        body && typeof body === "object"
          ? (body as { assistant?: CreatedAssistant }).assistant
          : undefined;
      if (!assistant?.id) throw new Error("Vapi did not return an assistant ID.");

      setCreatedAssistant(assistant);
      setFormMessage(`${assistant.name} is saved in Vapi and ready to test.`);
      setFormMessageTone("success");
      setCallState("idle");
      setCallMessage(null);
    } catch (error) {
      setFormMessage(readableError(error));
      setFormMessageTone("error");
    } finally {
      setIsCreating(false);
    }
  }

  function bindVapiEvents(vapi: Vapi) {
    vapi.on("call-start", () => {
      actionPendingRef.current = false;
      setCallState("live");
      setCallMessage(null);
      setAudioMessage(null);
    });

    vapi.on("call-end", () => {
      void uploadVoiceCapture();
      actionPendingRef.current = false;
      setCallState("idle");
      setPartialTranscript(null);
      setIsAssistantSpeaking(false);
      audioStateRef.current = "waiting";
      setAudioState("waiting");
      remoteMeterRef.current?.style.setProperty("--level", "0");
      localMeterRef.current?.style.setProperty("--level", "0");
      releaseMicrophone();
      vapi.removeAllListeners();
      vapiRef.current = null;
      clearAssistantAudio();
    });

    vapi.on("call-start-failed", (event) => {
      actionPendingRef.current = false;
      const message =
        event.error && event.error !== "Unknown error (null or undefined)"
          ? describeVapiStartError(event.error)
          : "Vapi could not start this call.";
      startFailureRef.current = message;
      if (voiceCaptureRef.current) {
        voiceCaptureRef.current.success = false;
        voiceCaptureRef.current.error = message;
      }
      void uploadVoiceCapture();
      releaseMicrophone();
      vapi.removeAllListeners();
      vapiRef.current = null;
      setCallState("error");
      setCallMessage(message);
    });

    vapi.on("call-start-success", (event) => {
      if (event.callId) {
        setDiagnosticCallId(event.callId);
        if (voiceCaptureRef.current) voiceCaptureRef.current.callId = event.callId;
      }
    });

    vapi.on("speech-start", () => {
      setIsAssistantSpeaking(true);
      void enableAssistantAudio();
    });
    vapi.on("speech-end", () => setIsAssistantSpeaking(false));

    vapi.on("volume-level", (volume) => {
      remoteMeterRef.current?.style.setProperty(
        "--level",
        String(Math.min(1, Math.max(0.04, volume))),
      );
      if (volume > 0.02 && audioStateRef.current !== "playing") {
        void enableAssistantAudio();
      }
    });

    vapi.on("local-volume-level", (volume) => {
      localMeterRef.current?.style.setProperty(
        "--level",
        String(Math.min(1, Math.max(0.04, volume))),
      );
    });

    vapi.on("message", (message) => {
      const endedReason = getCallEndedReason(message);
      if (endedReason) {
        const description = describeEndedReason(endedReason);
        if (description) {
          if (voiceCaptureRef.current) {
            voiceCaptureRef.current.success = false;
            voiceCaptureRef.current.error = description;
          }
          setCallState("error");
          setCallMessage(description);
        }
      }

      const nextTranscript = parseTranscriptMessage(message);
      if (!nextTranscript) return;

      if (nextTranscript.transcriptType === "partial") {
        setPartialTranscript({
          id: "partial",
          role: nextTranscript.role,
          text: nextTranscript.text,
        });
        return;
      }

      if (isDuplicateTranscriptTurn(captureTranscriptRef.current, nextTranscript)) {
        setPartialTranscript(null);
        return;
      }
      const agentEventId = crypto.randomUUID();
      captureTranscriptRef.current.push({
        role: nextTranscript.role,
        text: nextTranscript.text,
        agentEventId,
        modelEventId: crypto.randomUUID(),
      });
      setTranscript((current) => [
        ...current,
        { id: agentEventId, role: nextTranscript.role, text: nextTranscript.text },
      ]);
      setPartialTranscript(null);
    });

    vapi.on("error", (error) => {
      actionPendingRef.current = false;
      const message = getErrorMessage(error);
      if (message && message !== "Unknown error (null or undefined)") {
        const describedMessage = describeVapiStartError(message);
        startFailureRef.current = describedMessage;
        setCallMessage(describedMessage);
      }
      setCallState((current) =>
        current === "connecting" ? "error" : current,
      );
    });
  }

  async function startCall() {
    if (actionPendingRef.current || !canStartCall || !createdAssistant) return;

    actionPendingRef.current = true;
    setCallState("connecting");
    setCallMessage(null);
    startFailureRef.current = null;
    setDiagnosticCallId(null);
    setTranscript([]);
    captureTranscriptRef.current = [];
    setPartialTranscript(null);
    setDuration(0);
    audioStateRef.current = "waiting";
    setAudioState("waiting");
    setAudioMessage(null);
    clearAssistantAudio();
    voiceCaptureRef.current = {
      sessionId: crypto.randomUUID(),
      userId: getAnonymousUserId(),
      boundaryEventId: crypto.randomUUID(),
      assistantId: createdAssistant.id,
      startedAt: Date.now(),
      success: true,
    };

    try {
      const microphoneStream = await ensureMicrophoneAccess(
        navigator.mediaDevices,
      );
      microphoneStreamRef.current = microphoneStream;
      const microphoneTrack = microphoneStream.getAudioTracks()[0];
      const { default: VapiClient } = await import("@vapi-ai/web");
      const vapi = new VapiClient(
        publicKey,
        undefined,
        VAPI_DAILY_CONFIG,
        vapiDailyCallObject(microphoneTrack),
      );
      bindVapiEvents(vapi);
      vapiRef.current = vapi;

      const call = await vapi.start(createdAssistant.id);
      if (!call) {
        throw new Error(
          startFailureRef.current ??
            "Vapi did not create a web call. Verify that the public key and assistant belong to the same Vapi workspace.",
        );
      }
      vapi.setMuted(false);
      if (call.id) {
        setDiagnosticCallId(call.id);
        if (voiceCaptureRef.current) voiceCaptureRef.current.callId = call.id;
      }
    } catch (error) {
      const message = describeVapiStartError(readableError(error));
      if (voiceCaptureRef.current) {
        voiceCaptureRef.current.success = false;
        voiceCaptureRef.current.error = message;
      }
      void uploadVoiceCapture();
      releaseMicrophone();
      vapiRef.current?.removeAllListeners();
      vapiRef.current = null;
      actionPendingRef.current = false;
      setCallState("error");
      setCallMessage(message);
    }
  }

  async function endCall() {
    if (actionPendingRef.current || callState !== "live") return;
    actionPendingRef.current = true;
    setCallState("ending");
    setIsAssistantSpeaking(false);

    try {
      await vapiRef.current?.stop();
    } catch (error) {
      setCallMessage(readableError(error));
    } finally {
      void uploadVoiceCapture();
      releaseMicrophone();
      vapiRef.current?.removeAllListeners();
      vapiRef.current = null;
      actionPendingRef.current = false;
      setCallState("idle");
      setPartialTranscript(null);
      clearAssistantAudio();
    }
  }

  const stateLabel = {
    idle: createdAssistant ? "Ready to test" : "Build an assistant",
    connecting: "Opening voice channel",
    live: isAssistantSpeaking ? "Assistant speaking" : "Listening",
    ending: "Ending call",
    error: "Needs attention",
  }[callState];

  return (
    <main className="studio-shell">
      <div className="grain" aria-hidden="true" />
      <header className="studio-topbar">
        <a className="wordmark" href="#studio" aria-label="Relay studio home">
          <span className="wordmark-mark" aria-hidden="true">R</span>
          <span>Relay / Assistant studio</span>
        </a>
        <div className={`system-state state-${callState}`} aria-live="polite">
          <span className="system-dot" aria-hidden="true" />
          {stateLabel}
        </div>
      </header>

      <section className="studio-intro" id="studio">
        <div>
          <p className="kicker">Vapi voice laboratory · build 01</p>
          <h1>Shape the voice. <em>Then talk to it.</em></h1>
        </div>
        <p>
          Start from a working pattern, rewrite every word, choose a voice, and
          save a real assistant to your Vapi workspace.
        </p>
      </section>

      <div className="studio-grid">
        <section className="live-desk" aria-label="Live voice and transcription">
          <header className="section-heading">
            <span>01</span>
            <div>
              <p>Live desk</p>
              <h2>Voice &amp; transcription</h2>
            </div>
          </header>

          <div className={`voice-stage voice-${callState}`}>
            <div className="voice-orbit orbit-a" aria-hidden="true" />
            <div className="voice-orbit orbit-b" aria-hidden="true" />
            <div className="voice-core">
              <span>{callState === "live" ? formatDuration(duration) : "VAPI"}</span>
            </div>
            <div className="voice-stage-copy">
              <span>{createdAssistant?.name ?? "No assistant created"}</span>
              <strong>
                {callState === "live"
                  ? isAssistantSpeaking
                    ? "Speaking now"
                    : "Your microphone is open"
                  : createdAssistant
                    ? "Ready for a browser call"
                    : "Configure and create on the right"}
              </strong>
            </div>
          </div>

          <div className="call-actions">
            {callState === "live" || callState === "ending" ? (
              <button
                className="primary-action end-action"
                type="button"
                onClick={() => void endCall()}
                disabled={callState === "ending"}
              >
                <span className="action-symbol stop-symbol" aria-hidden="true" />
                <span><strong>{callState === "ending" ? "Closing line" : "End call"}</strong><small>{formatDuration(duration)}</small></span>
              </button>
            ) : (
              <button
                className="primary-action start-action"
                type="button"
                onClick={() => void startCall()}
                disabled={!canStartCall || callState === "connecting"}
              >
                <span className="action-symbol mic-symbol" aria-hidden="true" />
                <span><strong>{callState === "connecting" ? "Opening line" : "Start voice call"}</strong><small>{createdAssistant ? createdAssistant.configuration.voiceId : "Create first"}</small></span>
              </button>
            )}
          </div>

          {publicKeyError ? (
            <Notice tone="error">{publicKeyError}</Notice>
          ) : null}
          {callMessage ? (
            <Notice tone="error">
              {callMessage}
              {diagnosticCallId ? <a href={`https://dashboard.vapi.ai/calls/${diagnosticCallId}`} target="_blank" rel="noreferrer">Open call log · {diagnosticCallId}</a> : null}
            </Notice>
          ) : null}

          <div className="meter-stack" aria-hidden="true">
            <AudioMeter label="You" meterRef={localMeterRef} />
            <AudioMeter label="Assistant" meterRef={remoteMeterRef} reverse />
          </div>

          {callState === "live" ? (
            <div className={`audio-status audio-${audioState}`} aria-live="polite">
              <div><span>Assistant sound</span><strong>{audioState === "playing" ? "Playing" : audioState === "blocked" ? "Needs permission" : "Connecting"}</strong></div>
              {audioState !== "playing" ? <button type="button" onClick={() => void enableAssistantAudio()}>Enable sound</button> : null}
              {audioMessage ? <p>{audioMessage}</p> : null}
            </div>
          ) : null}

          <section className="transcript-card" aria-label="Live transcript">
            <header>
              <div><span className="live-glyph" aria-hidden="true" /> Live transcript</div>
              <button type="button" onClick={() => { setTranscript([]); setPartialTranscript(null); }} disabled={transcript.length === 0 && !partialTranscript}>Clear</button>
            </header>
            <div className="transcript-feed" aria-live="polite" aria-relevant="additions text">
              {transcript.length === 0 && !partialTranscript ? (
                <div className="empty-transcript"><span>“</span><h3>The room is quiet.</h3><p>Your conversation will appear here in real time.</p></div>
              ) : (
                <div className="transcript-list">
                  {transcript.map((entry, index) => <TranscriptRow entry={entry} index={index + 1} key={entry.id} />)}
                  {partialTranscript ? <TranscriptRow entry={partialTranscript} index={transcript.length + 1} partial /> : null}
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
            <footer><span>{String(transcript.length).padStart(2, "0")} final turns</span><span>{callState === "live" ? "Transcribing now" : "Retained in this tab"}</span></footer>
          </section>
        </section>

        <section className="builder-panel" aria-label="Assistant configuration">
          <header className="section-heading">
            <span>02</span>
            <div><p>Configuration</p><h2>Build your assistant</h2></div>
          </header>

          <fieldset className="builder-group" disabled={isCreating || isCallActive}>
            <legend><span>Template</span><small>Pick a starting behavior</small></legend>
            <div className="template-grid">
              {ASSISTANT_TEMPLATES.map((template) => (
                <button
                  className={`template-card${form.templateId === template.id ? " is-selected" : ""}`}
                  type="button"
                  key={template.id}
                  onClick={() => selectTemplate(template.id)}
                  aria-pressed={form.templateId === template.id}
                >
                  <span>{template.eyebrow}</span><strong>{template.label}</strong><small>{template.description}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="builder-group form-stack" disabled={isCreating || isCallActive}>
            <legend><span>Identity &amp; prompt</span><small>Everything here is editable</small></legend>
            <label className="studio-field"><span>Assistant name</span><input value={form.name} maxLength={40} onChange={(event) => updateForm("name", event.target.value)} placeholder="Studio assistant" /><small>{form.name.length}/40</small></label>
            <label className="studio-field prompt-field"><span>System prompt</span><textarea value={form.systemPrompt} maxLength={10_000} rows={9} onChange={(event) => updateForm("systemPrompt", event.target.value)} /><small>{form.systemPrompt.length}/10,000</small></label>
            <label className="studio-field"><span>First message</span><textarea value={form.firstMessage} maxLength={1_000} rows={3} onChange={(event) => updateForm("firstMessage", event.target.value)} /><small>{form.firstMessage.length}/1,000</small></label>
          </fieldset>

          <fieldset className="builder-group" disabled={isCreating || isCallActive}>
            <legend><span>Voice</span><small>Curated Vapi voices</small></legend>
            <div className="voice-grid">
              {VAPI_VOICES.map((voice) => (
                <button
                  className={`voice-card${form.voiceId === voice.id ? " is-selected" : ""}`}
                  type="button"
                  key={voice.id}
                  onClick={() => selectVoice(voice.id)}
                  aria-pressed={form.voiceId === voice.id}
                  style={{ "--voice-color": voice.color } as React.CSSProperties}
                >
                  <span className="voice-swatch" aria-hidden="true">{voice.label.slice(0, 1)}</span><span><strong>{voice.label}</strong><small>{voice.tone}</small></span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="build-summary">
            <div><span>Model</span><strong>OpenAI · GPT-4.1 mini</strong></div>
            <div><span>Transcription</span><strong>Deepgram · Nova-3</strong></div>
          </div>

          {formMessage ? <Notice tone={formMessageTone}>{formMessage}</Notice> : null}

          <button className="create-button" type="button" onClick={() => void createAssistant()} disabled={isCreating || isCallActive}>
            <span>{isCreating ? "Creating in Vapi…" : createdAssistant ? "Assistant created" : "Create assistant"}</span><span aria-hidden="true">↗</span>
          </button>
          <p className="private-key-note">Creation runs on the server. Your Vapi private key never enters the browser.</p>
        </section>
      </div>
    </main>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: "neutral" | "error" | "success" }) {
  const label = tone === "error" ? "Needs attention" : tone === "success" ? "Assistant ready" : "Studio note";
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}><span>{label}</span>{children}</div>;
}

function AudioMeter({ label, meterRef, reverse = false }: { label: string; meterRef: React.RefObject<HTMLDivElement | null>; reverse?: boolean }) {
  return <div className="audio-meter"><span>{label}</span><div className={`meter-bars${reverse ? " meter-reverse" : ""}`} ref={meterRef}>{WAVE_BARS.map((bar) => <i key={bar} style={{ "--bar-height": `${3 + (bar % 7) * 2}px` } as React.CSSProperties} />)}</div></div>;
}

function TranscriptRow({ entry, index, partial = false }: { entry: TranscriptEntry; index: number; partial?: boolean }) {
  return <article className={`transcript-row role-${entry.role}${partial ? " is-partial" : ""}`}><div className="transcript-meta"><span>{entry.role === "user" ? "You" : "Assistant"}</span><span>{String(index).padStart(2, "0")}</span></div><p>{entry.text}</p>{partial ? <span className="typing-cursor" aria-label="Transcribing" /> : null}</article>;
}
