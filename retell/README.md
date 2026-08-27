# Relay — Retell Assistant Studio

A two-column Next.js demo for creating and testing persistent Retell voice
agents. The left desk handles browser calls and live transcription. The right
builder provides editable presets, prompts, first messages, and voices loaded
from your Retell workspace.

## Run locally

Copy the environment template:

```sh
cp .env.example .env.local
```

Add the server-only API key from the Retell dashboard:

```dotenv
RETELL_API_KEY=your-retell-api-key
```

To send completed conversations to Currai, also configure:

```dotenv
CURRAI_PUBLIC_KEY=your-ingestion-public-key
CURRAI_SECRET_KEY=your-ingestion-secret-key
CURRAI_BASE_URL=https://www.currai.app
```

Then start the example:

```sh
pnpm install
pnpm dev
```

Open the printed local URL, select a template, edit its content, choose a
voice, and click **Create agent**. Once Retell returns the saved agent, click
**Start voice call** and allow microphone access.

## Key boundaries

- `RETELL_API_KEY` is server-only. It lists voices, creates the Retell LLM and
  agent, creates a one-call access token, and retrieves the completed call.
- The short-lived web-call access token is created only after Start is clicked
  and is immediately passed to the local LiveKit web-call transport.
- The browser never receives the Retell API key or Currai credentials, and the
  example does not depend on either Retell's server SDK or browser SDK.
- Created agents use a Retell LLM with OpenAI `gpt-4.1-mini` and the selected
  voice from the connected Retell workspace.
- Currai capture is best-effort and never changes the voice-call result.

## Call behavior

- Retell sends a rolling window of up to five utterances. The app reconciles
  those updates into a transcript retained for the entire browser call.
- A finished call leaves its transcript visible until it is cleared or a new
  call starts.
- If browser autoplay blocks remote audio, use **Enable sound** in the live
  desk.
- Microphone denial, unavailable devices, Retell failures, and call connection
  failures are shown directly in the interface.

## Verify

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

After a real call, inspect it in Retell Call History and confirm the matching
session, conversation turns, and nested model events in Currai Events.
