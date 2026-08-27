import assert from "node:assert/strict";
import test from "node:test";
import {
  describeEndedReason,
  describeVapiStartError,
  ensureMicrophoneAccess,
  getCallEndedReason,
  getErrorMessage,
  getVapiPublicKeyError,
  isDailyPostCallEjection,
  isDuplicateTranscriptTurn,
  parseTranscriptMessage,
  resumeAudioPlayback,
  VAPI_DAILY_CONFIG,
  vapiDailyCallObject,
} from "./vapi-helpers.ts";

test("keeps the validated microphone track alive for the Vapi call", async () => {
  let stopped = false;
  const audioTrack = {
    kind: "audio",
    stop() {
      stopped = true;
    },
  } as MediaStreamTrack;
  const mediaDevices = {
    async getUserMedia() {
      return {
        getAudioTracks: () => [audioTrack],
        getTracks: () => [audioTrack],
      } as MediaStream;
    },
  };

  const stream = await ensureMicrophoneAccess(mediaDevices);

  assert.equal(stream.getAudioTracks()[0], audioTrack);
  assert.equal(stopped, false);
  assert.deepEqual(VAPI_DAILY_CONFIG, {
    alwaysIncludeMicInPermissionPrompt: true,
  });
  assert.deepEqual(vapiDailyCallObject(audioTrack), {
    audioSource: audioTrack,
    startAudioOff: false,
  });
});

test("turns a denied permission into an actionable error", async () => {
  const mediaDevices = {
    async getUserMedia(): Promise<MediaStream> {
      throw new DOMException("Permission denied", "NotAllowedError");
    },
  };

  await assert.rejects(
    ensureMicrophoneAccess(mediaDevices),
    /Allow microphone access for this site/,
  );
});

test("reads nested Vapi and Daily error messages", () => {
  assert.equal(
    getErrorMessage({ error: { message: "Meeting ended due to ejection" } }),
    "Meeting ended due to ejection",
  );
});

test("recognizes Daily's harmless post-call ejection error", () => {
  assert.equal(
    isDailyPostCallEjection(
      new Error("Meeting ended due to ejection: Meeting has ended"),
    ),
    true,
  );
  assert.equal(
    isDailyPostCallEjection(new Error("Network disconnected")),
    false,
  );
});

test("reads and describes Vapi call-ended reasons", () => {
  const reason = getCallEndedReason({
    type: "status-update",
    status: "ended",
    call: { endedReason: "assistant-not-valid" },
  });

  assert.equal(reason, "assistant-not-valid");
  assert.ok(reason);
  assert.match(describeEndedReason(reason)!, /configuration is invalid/);
  assert.equal(describeEndedReason("customer-ended-call"), null);
});

test("deduplicates repeated final transcript messages", () => {
  const turns = [{ role: "assistant" as const, text: "Say hello." }];

  assert.equal(
    isDuplicateTranscriptTurn(turns, {
      role: "assistant",
      text: " Say hello. ",
    }),
    true,
  );
  assert.equal(
    isDuplicateTranscriptTurn(turns, { role: "user", text: "Say hello." }),
    false,
  );
});

test("parses partial and final Vapi transcript messages", () => {
  assert.deepEqual(
    parseTranscriptMessage({
      type: "transcript",
      role: "user",
      transcript: "  hello studio  ",
      transcriptType: "partial",
    }),
    {
      role: "user",
      text: "hello studio",
      transcriptType: "partial",
    },
  );
  assert.equal(parseTranscriptMessage({ type: "status-update" }), null);
});

test("unmutes and resumes every Vapi audio player", async () => {
  const players = [
    {
      muted: true,
      volume: 0,
      async play() {},
    },
    {
      muted: true,
      volume: 0.4,
      async play() {},
    },
  ];

  const result = await resumeAudioPlayback(players);

  assert.deepEqual(result, { found: 2, playing: 2, error: null });
  assert.deepEqual(
    players.map(({ muted, volume }) => ({ muted, volume })),
    [
      { muted: false, volume: 1 },
      { muted: false, volume: 1 },
    ],
  );
});

test("reports when the browser blocks assistant audio", async () => {
  const result = await resumeAudioPlayback([
    {
      muted: false,
      volume: 1,
      async play() {
        throw new DOMException(
          "Playback requires a user gesture",
          "NotAllowedError",
        );
      },
    },
  ]);

  assert.equal(result.found, 1);
  assert.equal(result.playing, 0);
  assert.match(result.error!, /user gesture/);
});

test("rejects placeholder Vapi public keys before opening a call", () => {
  assert.match(getVapiPublicKeyError("your-public-key")!, /placeholder/);
  assert.match(getVapiPublicKeyError("")!, /Add NEXT_PUBLIC/);
  assert.equal(getVapiPublicKeyError("a-real-looking-public-key-value"), null);
});

test("turns Vapi invalid-key responses into an actionable public-key error", () => {
  assert.match(
    describeVapiStartError(
      "Invalid Key. You may be using the private key instead of the public key.",
    ),
    /Vapi rejected NEXT_PUBLIC_VAPI_PUBLIC_KEY/,
  );
});
