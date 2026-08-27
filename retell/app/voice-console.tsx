"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASSISTANT_TEMPLATES,
  cloneTemplate,
  type AssistantForm,
  type CreatedAssistant,
  type RetellVoice,
  type TemplateId,
} from "./assistant-config";
import {
  audioLevel,
  describeRetellError,
  ensureMicrophoneAccess,
  getErrorMessage,
  parseRetellTranscript,
  reconcileRetellTranscript,
  type TranscriptTurn,
} from "./retell-helpers";
import type { RetellWebClient } from "./retell-web-client";

const WAVE_BARS = Array.from({ length: 28 }, (_, index) => index);
const ANONYMOUS_USER_KEY = "currai-anonymous-user-id";

type CallState = "idle" | "connecting" | "live" | "ending" | "error";
type AudioState = "waiting" | "playing" | "blocked";
type TranscriptEntry = TranscriptTurn & { id: string };

type VoiceCaptureContext = {
  sessionId: string;
  userId: string;
  boundaryEventId: string;
  agentId: string;
  callId?: string;
  startedAt: number;
  endedAt?: number;
  success: boolean;
  error?: string;
  payload?: Record<string, unknown>;
  upload?: Promise<boolean>;
};

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

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function voiceColor(id: string) {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 78% 72%)`;
}

function entriesFor(turns: readonly TranscriptTurn[]) {
  return turns.map((turn, index) => ({
    ...turn,
    id: `${index}-${turn.role}-${turn.text}`,
  }));
}

export default function VoiceConsole() {
  const [form, setForm] = useState<AssistantForm>(() => cloneTemplate("general"));
  const [voices, setVoices] = useState<RetellVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [createdAssistant, setCreatedAssistant] = useState<CreatedAssistant | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [formMessageTone, setFormMessageTone] = useState<"neutral" | "error" | "success">("neutral");
  const [callState, setCallState] = useState<CallState>("idle");
  const [callMessage, setCallMessage] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [duration, setDuration] = useState(0);
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [audioState, setAudioState] = useState<AudioState>("waiting");
  const [audioMessage, setAudioMessage] = useState<string | null>(null);

  const retellRef = useRef<RetellWebClient | null>(null);
  const actionPendingRef = useRef(false);
  const transcriptRef = useRef<TranscriptTurn[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const remoteMeterRef = useRef<HTMLDivElement>(null);
  const localMeterRef = useRef<HTMLDivElement>(null);
  const voiceCaptureRef = useRef<VoiceCaptureContext | null>(null);

  const isCallActive = ["connecting", "live", "ending"].includes(callState);
  const canStartCall = Boolean(createdAssistant && !isCallActive);

  const loadVoices = useCallback(async () => {
    setVoicesLoading(true);
    setVoicesError(null);
    try {
      const response = await fetch("/api/voices", { cache: "no-store" });
      const body = (await response.json()) as unknown;
      const error = getResponseError(body);
      if (!response.ok || error) throw new Error(error ?? "Voices could not be loaded.");
      const nextVoices =
        body && typeof body === "object" && Array.isArray((body as { voices?: unknown }).voices)
          ? (body as { voices: RetellVoice[] }).voices
          : [];
      if (nextVoices.length === 0) throw new Error("No Retell voices are available in this workspace.");
      setVoices(nextVoices);
      setForm((current) => current.voiceId ? current : { ...current, voiceId: nextVoices[0].id });
    } catch (error) {
      setVoicesError(getErrorMessage(error) ?? "Retell voices could not be loaded.");
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadVoices(), 0);
    return () => window.clearTimeout(timer);
  }, [loadVoices]);
  useEffect(() => () => {
    retellRef.current?.removeAllListeners();
    retellRef.current?.stopCall();
  }, []);
  useEffect(() => {
    if (callState !== "live") return;
    const timer = window.setInterval(() => setDuration((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [callState]);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [transcript]);

  function invalidateAssistant(message = "Configuration changed. Create a new agent to test it.") {
    setCreatedAssistant(null);
    setFormMessage(message);
    setFormMessageTone("neutral");
  }

  function updateForm<Key extends keyof AssistantForm>(key: Key, value: AssistantForm[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
    if (createdAssistant) invalidateAssistant();
    else setFormMessage(null);
  }

  function selectTemplate(templateId: TemplateId) {
    setForm((current) => cloneTemplate(templateId, current.voiceId));
    invalidateAssistant("Template loaded. Edit it freely, then create your agent.");
  }

  async function uploadVoiceCapture() {
    const capture = voiceCaptureRef.current;
    if (!capture) return false;
    if (capture.upload) return capture.upload;
    capture.endedAt ??= Date.now();
    capture.payload ??= {
      sessionId: capture.sessionId,
      userId: capture.userId,
      boundaryEventId: capture.boundaryEventId,
      agentId: capture.agentId,
      ...(capture.callId ? { callId: capture.callId } : {}),
      startedAt: capture.startedAt,
      endedAt: capture.endedAt,
      success: capture.success,
      ...(capture.error ? { error: capture.error } : {}),
      transcript: transcriptRef.current,
    };
    capture.upload = (async () => {
      for (const delay of [0, 750, 2_000]) {
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

  async function createAssistant() {
    if (isCreating || isCallActive || !form.voiceId) return;
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
      if (!response.ok || error) throw new Error(error ?? "The agent could not be created.");
      const assistant = body && typeof body === "object" ? (body as { assistant?: CreatedAssistant }).assistant : undefined;
      if (!assistant?.id) throw new Error("Retell did not return an agent ID.");
      setCreatedAssistant(assistant);
      setFormMessage(`${assistant.name} is saved in Retell and ready to test.`);
      setFormMessageTone("success");
      setCallState("idle");
      setCallMessage(null);
    } catch (error) {
      setFormMessage(describeRetellError(error));
      setFormMessageTone("error");
    } finally {
      setIsCreating(false);
    }
  }

  function bindRetellEvents(client: RetellWebClient) {
    client.on("call_started", () => {
      actionPendingRef.current = false;
      setCallState("live");
      setCallMessage(null);
      localMeterRef.current?.style.setProperty("--level", "0.28");
    });
    client.on("call_ready", () => {
      setAudioState("playing");
      setAudioMessage(null);
    });
    client.on("agent_start_talking", () => setIsAssistantSpeaking(true));
    client.on("agent_stop_talking", () => {
      setIsAssistantSpeaking(false);
      remoteMeterRef.current?.style.setProperty("--level", "0");
    });
    client.on("audio", (samples: Float32Array) => {
      remoteMeterRef.current?.style.setProperty("--level", String(audioLevel(samples)));
    });
    client.on("update", (update: unknown) => {
      const incoming = parseRetellTranscript(update);
      if (incoming.length === 0) return;
      const reconciled = reconcileRetellTranscript(transcriptRef.current, incoming);
      transcriptRef.current = reconciled;
      setTranscript(entriesFor(reconciled));
    });
    client.on("call_ended", () => {
      void uploadVoiceCapture();
      actionPendingRef.current = false;
      setCallState("idle");
      setIsAssistantSpeaking(false);
      setAudioState("waiting");
      localMeterRef.current?.style.setProperty("--level", "0");
      remoteMeterRef.current?.style.setProperty("--level", "0");
      client.removeAllListeners();
      if (retellRef.current === client) retellRef.current = null;
    });
    client.on("error", (error: unknown) => {
      const message = describeRetellError(error);
      if (voiceCaptureRef.current) {
        voiceCaptureRef.current.success = false;
        voiceCaptureRef.current.error = message;
      }
      actionPendingRef.current = false;
      setCallState("error");
      setCallMessage(message);
      client.stopCall();
    });
  }

  async function startCall() {
    if (actionPendingRef.current || !canStartCall || !createdAssistant) return;
    actionPendingRef.current = true;
    setCallState("connecting");
    setCallMessage(null);
    setCallId(null);
    setTranscript([]);
    transcriptRef.current = [];
    setDuration(0);
    setAudioState("waiting");
    setAudioMessage(null);
    const capture: VoiceCaptureContext = {
      sessionId: crypto.randomUUID(),
      userId: getAnonymousUserId(),
      boundaryEventId: crypto.randomUUID(),
      agentId: createdAssistant.id,
      startedAt: Date.now(),
      success: true,
    };
    voiceCaptureRef.current = capture;

    try {
      await ensureMicrophoneAccess(navigator.mediaDevices);
      const response = await fetch("/api/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: createdAssistant.id }),
      });
      const body = (await response.json()) as unknown;
      const error = getResponseError(body);
      if (!response.ok || error) throw new Error(error ?? "The web call could not be created.");
      const call = body as { accessToken?: unknown; callId?: unknown };
      if (typeof call.accessToken !== "string" || typeof call.callId !== "string") {
        throw new Error("Retell returned an invalid web-call token.");
      }
      capture.callId = call.callId;
      setCallId(call.callId);
      const { RetellWebClient: Client } = await import("./retell-web-client");
      const client = new Client();
      bindRetellEvents(client);
      retellRef.current = client;
      await client.startCall({ accessToken: call.accessToken, emitRawAudioSamples: true });
    } catch (error) {
      const message = describeRetellError(error);
      capture.success = false;
      capture.error = message;
      void uploadVoiceCapture();
      retellRef.current?.removeAllListeners();
      retellRef.current?.stopCall();
      retellRef.current = null;
      actionPendingRef.current = false;
      setCallState("error");
      setCallMessage(message);
    }
  }

  async function enableAssistantAudio() {
    const client = retellRef.current;
    if (!client) return;
    try {
      await client.startAudioPlayback();
      setAudioState("playing");
      setAudioMessage(null);
    } catch (error) {
      setAudioState("blocked");
      setAudioMessage(getErrorMessage(error) ?? "Your browser paused the agent audio.");
    }
  }

  async function endCall() {
    if (actionPendingRef.current || callState !== "live") return;
    actionPendingRef.current = true;
    setCallState("ending");
    setIsAssistantSpeaking(false);
    try {
      retellRef.current?.stopCall();
    } catch (error) {
      setCallMessage(describeRetellError(error));
    } finally {
      void uploadVoiceCapture();
      actionPendingRef.current = false;
      setCallState("idle");
    }
  }

  const stateLabel = {
    idle: createdAssistant ? "Ready to test" : "Build an agent",
    connecting: "Opening voice channel",
    live: isAssistantSpeaking ? "Agent speaking" : "Listening",
    ending: "Ending call",
    error: "Needs attention",
  }[callState];

  return (
    <main className="studio-shell">
      <div className="grain" aria-hidden="true" />
      <header className="studio-topbar">
        <a className="wordmark" href="#studio" aria-label="Relay studio home"><span className="wordmark-mark" aria-hidden="true">R</span><span>Relay / Retell studio</span></a>
        <div className={`system-state state-${callState}`} aria-live="polite"><span className="system-dot" aria-hidden="true" />{stateLabel}</div>
      </header>
      <section className="studio-intro" id="studio">
        <div><p className="kicker">Retell voice laboratory · build 01</p><h1>Shape the voice. <em>Then talk to it.</em></h1></div>
        <p>Start from a working pattern, rewrite every word, choose a voice, and save a real agent to your Retell workspace.</p>
      </section>
      <div className="studio-grid">
        <section className="live-desk" aria-label="Live voice and transcription">
          <header className="section-heading"><span>01</span><div><p>Live desk</p><h2>Voice &amp; transcription</h2></div></header>
          <div className={`voice-stage voice-${callState}`}><div className="voice-orbit orbit-a" aria-hidden="true" /><div className="voice-orbit orbit-b" aria-hidden="true" /><div className="voice-core"><span>{callState === "live" ? formatDuration(duration) : "RETELL"}</span></div><div className="voice-stage-copy"><span>{createdAssistant?.name ?? "No agent created"}</span><strong>{callState === "live" ? isAssistantSpeaking ? "Speaking now" : "Your microphone is open" : createdAssistant ? "Ready for a browser call" : "Configure and create on the right"}</strong></div></div>
          <div className="call-actions">{callState === "live" || callState === "ending" ? <button className="primary-action end-action" type="button" onClick={() => void endCall()} disabled={callState === "ending"}><span className="action-symbol stop-symbol" aria-hidden="true" /><span><strong>{callState === "ending" ? "Closing line" : "End call"}</strong><small>{formatDuration(duration)}</small></span></button> : <button className="primary-action start-action" type="button" onClick={() => void startCall()} disabled={!canStartCall || callState === "connecting"}><span className="action-symbol mic-symbol" aria-hidden="true" /><span><strong>{callState === "connecting" ? "Opening line" : "Start voice call"}</strong><small>{createdAssistant ? createdAssistant.configuration.voiceId : "Create first"}</small></span></button>}</div>
          {callMessage ? <Notice tone="error">{callMessage}{callId ? <a href={`https://beta.retellai.com/dashboard/calls/${callId}`} target="_blank" rel="noreferrer">Open call log · {callId}</a> : null}</Notice> : null}
          <div className="meter-stack" aria-hidden="true"><AudioMeter label="You" meterRef={localMeterRef} /><AudioMeter label="Agent" meterRef={remoteMeterRef} reverse /></div>
          {callState === "live" ? <div className={`audio-status audio-${audioState}`} aria-live="polite"><div><span>Agent sound</span><strong>{audioState === "playing" ? "Playing" : audioState === "blocked" ? "Needs permission" : "Connecting"}</strong></div>{audioState !== "playing" ? <button type="button" onClick={() => void enableAssistantAudio()}>Enable sound</button> : null}{audioMessage ? <p>{audioMessage}</p> : null}</div> : null}
          <section className="transcript-card" aria-label="Live transcript"><header><div><span className="live-glyph" aria-hidden="true" /> Live transcript</div><button type="button" onClick={() => { transcriptRef.current = []; setTranscript([]); }} disabled={transcript.length === 0}>Clear</button></header><div className="transcript-feed" aria-live="polite" aria-relevant="additions text">{transcript.length === 0 ? <div className="empty-transcript"><span>“</span><h3>The room is quiet.</h3><p>Your conversation will appear here in real time.</p></div> : <div className="transcript-list">{transcript.map((entry, index) => <TranscriptRow entry={entry} index={index + 1} key={entry.id} />)}</div>}<div ref={transcriptEndRef} /></div><footer><span>{String(transcript.length).padStart(2, "0")} turns</span><span>{callState === "live" ? "Transcribing now" : "Retained in this tab"}</span></footer></section>
        </section>
        <section className="builder-panel" aria-label="Agent configuration">
          <header className="section-heading"><span>02</span><div><p>Configuration</p><h2>Build your agent</h2></div></header>
          <fieldset className="builder-group" disabled={isCreating || isCallActive}><legend><span>Template</span><small>Pick a starting behavior</small></legend><div className="template-grid">{ASSISTANT_TEMPLATES.map((template) => <button className={`template-card${form.templateId === template.id ? " is-selected" : ""}`} type="button" key={template.id} onClick={() => selectTemplate(template.id)} aria-pressed={form.templateId === template.id}><span>{template.eyebrow}</span><strong>{template.label}</strong><small>{template.description}</small></button>)}</div></fieldset>
          <fieldset className="builder-group form-stack" disabled={isCreating || isCallActive}><legend><span>Identity &amp; prompt</span><small>Everything here is editable</small></legend><label className="studio-field"><span>Agent name</span><input value={form.name} maxLength={40} onChange={(event) => updateForm("name", event.target.value)} placeholder="Studio agent" /><small>{form.name.length}/40</small></label><label className="studio-field prompt-field"><span>System prompt</span><textarea value={form.systemPrompt} maxLength={10_000} rows={9} onChange={(event) => updateForm("systemPrompt", event.target.value)} /><small>{form.systemPrompt.length}/10,000</small></label><label className="studio-field"><span>First message</span><textarea value={form.firstMessage} maxLength={1_000} rows={3} onChange={(event) => updateForm("firstMessage", event.target.value)} /><small>{form.firstMessage.length}/1,000</small></label></fieldset>
          <fieldset className="builder-group" disabled={isCreating || isCallActive || voicesLoading}><legend><span>Voice</span><small>Available in your Retell workspace</small></legend>{voicesLoading ? <p className="private-key-note">Loading Retell voices…</p> : voicesError ? <Notice tone="error">{voicesError}<button type="button" onClick={() => void loadVoices()}>Retry</button></Notice> : <div className="voice-grid">{voices.map((voice) => <button className={`voice-card${form.voiceId === voice.id ? " is-selected" : ""}`} type="button" key={voice.id} onClick={() => updateForm("voiceId", voice.id)} aria-pressed={form.voiceId === voice.id} style={{ "--voice-color": voiceColor(voice.id) } as React.CSSProperties}><span className="voice-swatch" aria-hidden="true">{voice.name.slice(0, 1)}</span><span><strong>{voice.name}</strong><small>{[voice.accent, voice.gender, voice.provider].filter(Boolean).join(" · ")}</small></span></button>)}</div>}</fieldset>
          <div className="build-summary"><div><span>Model</span><strong>OpenAI · GPT-4.1 mini</strong></div><div><span>Voice platform</span><strong>Retell AI</strong></div></div>
          {formMessage ? <Notice tone={formMessageTone}>{formMessage}</Notice> : null}
          <button className="create-button" type="button" onClick={() => void createAssistant()} disabled={isCreating || isCallActive || !form.voiceId}><span>{isCreating ? "Creating in Retell…" : createdAssistant ? "Agent created" : "Create agent"}</span><span aria-hidden="true">↗</span></button>
          <p className="private-key-note">Creation runs on the server. Your Retell API key never enters the browser.</p>
        </section>
      </div>
    </main>
  );
}

function Notice({ children, tone }: { children: React.ReactNode; tone: "neutral" | "error" | "success" }) {
  const label = tone === "error" ? "Needs attention" : tone === "success" ? "Agent ready" : "Studio note";
  return <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}><span>{label}</span>{children}</div>;
}

function AudioMeter({ label, meterRef, reverse = false }: { label: string; meterRef: React.RefObject<HTMLDivElement | null>; reverse?: boolean }) {
  return <div className="audio-meter"><span>{label}</span><div className={`meter-bars${reverse ? " meter-reverse" : ""}`} ref={meterRef}>{WAVE_BARS.map((bar) => <i key={bar} style={{ "--bar-height": `${3 + (bar % 7) * 2}px` } as React.CSSProperties} />)}</div></div>;
}

function TranscriptRow({ entry, index }: { entry: TranscriptEntry; index: number }) {
  return <article className={`transcript-row role-${entry.role}`}><div className="transcript-meta"><span>{entry.role === "user" ? "You" : "Agent"}</span><span>{String(index).padStart(2, "0")}</span></div><p>{entry.text}</p></article>;
}
