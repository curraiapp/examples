# Currai examples

Production-shaped examples for connecting AI applications to [Currai](https://www.currai.app) with native HTTP capture.

| Example | What it demonstrates |
| --- | --- |
| [Chatbot](./chatbot) | Streaming OpenAI chat with nested model and Exa MCP tool events |
| [Vapi](./vapi) | Browser voice calls, finalized transcripts, and Vapi conversation traces |
| [Retell AI](./retell) | Retell web calls, rolling transcript reconciliation, and completed-call capture |
| [OpenAI voice](./openai) | Direct OpenAI Realtime WebRTC, live transcription, and nested voice-model traces |

Each folder is an independent application. Enter the example you want to run, copy its environment template, install its dependencies, and start it:

```bash
cd openai
cp .env.example .env.local
pnpm install
pnpm dev
```

Read the example's own README for provider-specific credentials and verification steps.

## Security

- Real `.env` files are ignored. Only placeholder-only `.env.example` files are committed.
- OpenAI, Retell AI, Vapi private, Exa, and Currai ingestion credentials stay in server code.
- Browser-public or temporary provider credentials are identified explicitly in each example.
- Currai capture is best-effort, redacts sensitive keys, uses short timeouts, and never changes the product request or voice-call result.
- Generated dependencies, build output, coverage, local caches, and editor files are not committed.

Before deploying an example, apply your own authentication, authorization, rate limits, consent flow, data-retention policy, and abuse controls.

## Currai Skill

You can use the published Currai Skill to instrument another application with the same native HTTP capture pattern:

```bash
npx skills add https://github.com/curraiapp/skills --skill currai
```

See the [Currai documentation](https://www.currai.app/docs) for setup and provider-specific guides.
