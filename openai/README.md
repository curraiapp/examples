# Relay — OpenAI Realtime Assistant Studio

A standalone Next.js example for configuring and testing OpenAI Realtime voice assistants. The left desk runs a direct browser WebRTC call with live transcription. The right builder provides editable presets, prompts, first messages, and supported OpenAI voices.

No OpenAI SDK is required. The browser uses standard WebRTC APIs and sends its SDP offer to this application's server. The server attaches the selected session configuration and calls OpenAI's unified Realtime endpoint with the server-only API key.

## Run locally

Copy the environment template:

```sh
cp .env.example .env.local
```

Add your server-only OpenAI API key:

```dotenv
OPENAI_API_KEY=your-openai-api-key
```

To send completed conversations to Currai, also configure:

```dotenv
CURRAI_PUBLIC_KEY=your-ingestion-public-key
CURRAI_SECRET_KEY=your-ingestion-secret-key
CURRAI_BASE_URL=https://www.currai.app
```

Install and start the example:

```sh
pnpm install
pnpm dev
```

Open the printed local URL, select a template, edit its content, choose a voice, and click **Create assistant**. Then click **Start voice call** and allow microphone access.

## Security boundaries

- `OPENAI_API_KEY` and all Currai credentials stay on the server.
- The browser receives only OpenAI's SDP answer; it never receives an API key or bearer token.
- Assistant input and session configuration are validated again on the server.
- Currai capture rejects secrets and credentials, uses a short timeout, and never changes the voice-call result.
- The example has no OpenAI SDK dependency and is not part of the root workspace.

## Call behavior

- The browser connects with WebRTC, plays the remote OpenAI audio track, and exchanges Realtime events over a data channel.
- Completed user and assistant transcript events are retained for the full call. Streaming assistant deltas update the active transcript without creating duplicates.
- The configured first message is generated as the assistant's opening response after the data channel opens.
- A finished call leaves its transcript visible until it is cleared or a new call starts.
- Microphone denial, OpenAI API failures, WebRTC failures, and browser autoplay restrictions are shown in the interface.

## Currai event shape

Each complete call creates one Currai session with an `openai.realtime_call` boundary. Readable `openai.conversation.turn` events contain recognized user and assistant evidence, and each has a nested `openai.realtime.model` event with `provider: "openai"` and `model: "gpt-realtime-2.1"`.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

With real credentials, complete one browser call and confirm the full transcript remains visible. Then verify the corresponding Currai User Story and the nested Realtime trace in Currai Events.
