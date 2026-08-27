import {
  RemoteAudioTrack,
  Room,
  RoomEvent,
  Track,
  createAudioAnalyser,
} from "livekit-client";

const RETELL_LIVEKIT_URL = "wss://retell-ai-4ihahnq7.livekit.cloud";
const decoder = new TextDecoder();

type ClientEvents = {
  audio: [Float32Array];
  call_ended: [];
  call_ready: [];
  call_started: [];
  agent_start_talking: [];
  agent_stop_talking: [];
  error: [unknown];
  update: [unknown];
};

type StoredListener = (payload?: unknown) => void;

export type StartCallConfig = {
  accessToken: string;
  emitRawAudioSamples?: boolean;
};

/**
 * Minimal Retell web-call transport. Retell's REST API supplies the short-lived
 * LiveKit token; this class joins that room without depending on Retell's SDK.
 */
export class RetellWebClient {
  private room: Room | null = null;
  private connected = false;
  private listeners = new Map<keyof ClientEvents, Set<StoredListener>>();
  private analyser: ReturnType<typeof createAudioAnalyser> | null = null;
  private animationFrame: number | null = null;

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

  async startCall(config: StartCallConfig) {
    const room = new Room({
      audioCaptureDefaults: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    this.room = room;
    this.bindRoomEvents(room, config);

    try {
      await room.connect(RETELL_LIVEKIT_URL, config.accessToken);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.connected = true;
      this.emit("call_started");
    } catch (error) {
      await room.disconnect();
      this.room = null;
      this.emit("error", error);
      throw error;
    }
  }

  async startAudioPlayback() {
    await this.room?.startAudio();
  }

  stopCall() {
    const wasConnected = this.connected;
    this.connected = false;
    this.stopAudioAnalysis();
    this.room?.disconnect();
    this.room = null;
    if (wasConnected) this.emit("call_ended");
  }

  private emit<Event extends keyof ClientEvents>(
    event: Event,
    ...args: ClientEvents[Event]
  ) {
    for (const listener of this.listeners.get(event) ?? []) listener(args[0]);
  }

  private bindRoomEvents(room: Room, config: StartCallConfig) {
    room.on(RoomEvent.Disconnected, () => this.stopCall());
    room.on(RoomEvent.TrackSubscribed, (track, publication) => {
      if (track.kind !== Track.Kind.Audio || !(track instanceof RemoteAudioTrack)) return;
      if (publication.trackName === "agent_audio") {
        this.emit("call_ready");
        if (config.emitRawAudioSamples) {
          this.analyser = createAudioAnalyser(track);
          this.captureAudioSamples();
        }
      }
      track.attach();
    });
    room.on(RoomEvent.DataReceived, (payload, participant) => {
      if (participant?.identity !== "server") return;
      this.handleServerMessage(payload);
    });
  }

  private handleServerMessage(payload: Uint8Array) {
    try {
      const event = JSON.parse(decoder.decode(payload)) as Record<string, unknown>;
      if (event.event_type === "update") this.emit("update", event);
      if (event.event_type === "agent_start_talking") this.emit("agent_start_talking");
      if (event.event_type === "agent_stop_talking") this.emit("agent_stop_talking");
    } catch {
      // Ignore malformed room data. Audio must continue uninterrupted.
    }
  }

  private captureAudioSamples() {
    if (!this.connected || !this.analyser) return;
    const samples = new Float32Array(this.analyser.analyser.fftSize);
    this.analyser.analyser.getFloatTimeDomainData(samples);
    this.emit("audio", samples);
    this.animationFrame = window.requestAnimationFrame(() => this.captureAudioSamples());
  }

  private stopAudioAnalysis() {
    if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
    void this.analyser?.cleanup();
    this.analyser = null;
  }
}
