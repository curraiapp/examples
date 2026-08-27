# Relay — Vapi Assistant Studio

A two-column Next.js demo for creating and testing persistent Vapi voice
assistants. The left desk handles browser calls, audio recovery, and streaming
transcription. The right builder provides editable presets, prompts, first
messages, and a curated Vapi voice picker.

## Run locally

Copy the environment template:

```sh
cp .env.example .env.local
```

Add both keys from the Vapi dashboard:

```dotenv
NEXT_PUBLIC_VAPI_PUBLIC_KEY=your-public-key
VAPI_PRIVATE_KEY=your-private-key
```

To send completed conversations to Currai, also configure:

```dotenv
CURRAI_PUBLIC_KEY=your-ingestion-public-key
CURRAI_SECRET_KEY=your-ingestion-secret-key
CURRAI_BASE_URL=https://www.currai.app
```

Then start the example:

```sh
pnpm dev
```

Open the printed local URL, select a template, edit its content, choose a
voice, and click **Create assistant**. Once Vapi returns the saved assistant,
click **Start voice call** and allow microphone access.

## Key boundaries

- `NEXT_PUBLIC_VAPI_PUBLIC_KEY` is intentionally available to the browser and
  is used only to start WebRTC calls.
- `VAPI_PRIVATE_KEY` is read only by `POST /api/assistants`. It is never sent
  in the API response or imported into client code.
- Currai ingestion credentials are server-only. Completed calls are captured
  best-effort and never change the Vapi call result.
- The server route accepts only the typed local templates and curated voices.
  It builds the Vapi provider payload itself.
- Created assistants use OpenAI `gpt-4.1-mini`, Deepgram `nova-3`, and the
  selected Vapi-hosted voice.

## Call behavior

- Partial transcript messages update in place; final turns are appended once.
- A finished call leaves its transcript visible until it is cleared or a new
  call starts.
- If browser autoplay blocks remote audio, use **Enable sound** in the live
  desk.
- Microphone denial, missing devices, busy devices, Vapi failures, and call
  connection failures are shown directly in the interface.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

If a call fails after connecting, use the call-log link shown in the error
notice to inspect the matching Vapi dashboard event.
