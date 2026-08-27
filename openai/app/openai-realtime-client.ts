import type { AssistantForm } from "./assistant-config";
import {
  applyRealtimeTranscriptEvent,
  getErrorMessage,
  type TranscriptTurn,
} from "./openai-helpers";

type ClientEvents = {
  audio_blocked: [unknown];
  call_ended: [];
  call_ready: [];
  call_started: [{ callId?: string }];
  assistant_start_talking: [];
  assistant_stop_talking: [];
  error: [unknown];
  transcript: [TranscriptTurn[]];
};

type StoredListener = (payload?: unknown) => void;

export class OpenAIRealtimeClient {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private connected = false;
  private ended = false;
  private transcript: TranscriptTurn[] = [];
  private listeners = new Map<keyof ClientEvents, Set<StoredListener>>();

  on<Event extends keyof ClientEvents>(
    event: Event,
    listener: (...args: ClientEvents[Event]) => void,
  ) {
    const listeners = this.listeners.get(event) ?? new Set<StoredListener>();
    listeners.add(listener as StoredListener);
    this.listeners.set(event, listeners);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
  }

  async startCall(config: {
    assistant: AssistantForm;
    microphone: MediaStream;
  }) {
    const peer = new RTCPeerConnection();
    const channel = peer.createDataChannel("oai-events");
    const remoteAudio = document.createElement("audio");
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute("playsinline", "");

    this.peer = peer;
    this.channel = channel;
    this.microphone = config.microphone;
    this.remoteAudio = remoteAudio;
    this.ended = false;
    this.transcript = [];

    for (const track of config.microphone.getTracks()) {
      peer.addTrack(track, config.microphone);
    }

    peer.ontrack = (event) => {
      remoteAudio.srcObject = event.streams[0];
      void remoteAudio
        .play()
        .then(() => this.emit("call_ready"))
        .catch((error) => this.emit("audio_blocked", error));
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") {
        this.emit("error", new Error("The WebRTC peer connection failed."));
      }
      if (peer.connectionState === "closed") this.finish();
    };
    channel.onmessage = (event) => this.handleEvent(event.data);
    channel.onerror = () =>
      this.emit("error", new Error("The OpenAI event channel failed."));

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (!offer.sdp) throw new Error("The browser did not create an SDP offer.");

    const response = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: offer.sdp, assistant: config.assistant }),
    });
    const body = (await response.json()) as {
      sdp?: unknown;
      callId?: unknown;
      error?: unknown;
    };
    if (!response.ok || typeof body.sdp !== "string") {
      throw new Error(
        typeof body.error === "string"
          ? body.error
          : "OpenAI did not return a valid WebRTC answer.",
      );
    }

    await peer.setRemoteDescription({ type: "answer", sdp: body.sdp });
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("The OpenAI event channel timed out.")),
        15_000,
      );
      channel.onopen = () => {
        window.clearTimeout(timeout);
        this.connected = true;
        this.emit("call_started", {
          ...(typeof body.callId === "string" ? { callId: body.callId } : {}),
        });
        channel.send(
          JSON.stringify({
            type: "response.create",
            response: {
              output_modalities: ["audio"],
              instructions: `Open the conversation by saying exactly this message, then wait for the user: ${JSON.stringify(config.assistant.firstMessage)}`,
            },
          }),
        );
        resolve();
      };
    });
  }

  async startAudioPlayback() {
    if (!this.remoteAudio)
      throw new Error("Remote audio is not available yet.");
    await this.remoteAudio.play();
    this.emit("call_ready");
  }

  stopCall() {
    this.finish();
  }

  private handleEvent(raw: unknown) {
    try {
      const event = JSON.parse(String(raw)) as Record<string, unknown>;
      if (event.type === "error") {
        this.emit(
          "error",
          new Error(
            getErrorMessage(event.error) ?? "OpenAI returned a Realtime error.",
          ),
        );
        return;
      }
      if (
        event.type === "response.output_audio.delta" ||
        event.type === "response.audio.delta" ||
        event.type === "output_audio_buffer.started"
      ) {
        this.emit("assistant_start_talking");
      }
      if (
        event.type === "response.done" ||
        event.type === "output_audio_buffer.stopped" ||
        event.type === "output_audio_buffer.cleared"
      ) {
        this.emit("assistant_stop_talking");
      }
      const next = applyRealtimeTranscriptEvent(this.transcript, event);
      if (JSON.stringify(next) !== JSON.stringify(this.transcript)) {
        this.transcript = next;
        this.emit("transcript", [...next]);
      }
    } catch {
      // Ignore malformed provider events so audio can continue.
    }
  }

  private finish() {
    if (this.ended) return;
    this.ended = true;
    const wasConnected = this.connected;
    this.connected = false;
    this.channel?.close();
    this.peer?.close();
    this.microphone?.getTracks().forEach((track) => track.stop());
    if (this.remoteAudio) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
    }
    this.channel = null;
    this.peer = null;
    this.microphone = null;
    this.remoteAudio = null;
    if (wasConnected) this.emit("call_ended");
  }

  private emit<Event extends keyof ClientEvents>(
    event: Event,
    ...args: ClientEvents[Event]
  ) {
    for (const listener of this.listeners.get(event) ?? []) listener(args[0]);
  }
}
