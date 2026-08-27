# OpenAI Chat Lab

A deliberately small Next.js chatbot used as an integration test target. It
uses the Vercel AI SDK and OpenAI to stream a multi-turn conversation. The
assistant can search and fetch live web content through Exa's hosted MCP
server. The server-side chat route sends native HTTP session and nested
agent/model/MCP tool events to Currai without adding a Currai SDK dependency.

## Run locally

From the `chatbot` directory:

```bash
cp .env.example .env.local
```

Add your OpenAI API key to `.env.local`, then run:

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). If that port is occupied,
Next.js prints the available port it selected.

## Environment

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | Yes | Server-side OpenAI API key. Never expose it with a `NEXT_PUBLIC_` prefix. |
| `OPENAI_MODEL` | No | OpenAI model ID. Defaults to `gpt-5.6-luna`. |
| `EXA_API_KEY` | No | Exa API key for production use and higher MCP rate limits. The hosted MCP server's free tier works without one. |
| `CURRAI_PUBLIC_KEY` | Yes | Server-only Currai ingestion public key. |
| `CURRAI_SECRET_KEY` | Yes | Server-only Currai ingestion secret key. |
| `CURRAI_BASE_URL` | Yes | Currai API base URL. Use `https://www.currai.app` outside local Currai development. |

The assistant prompt is intentionally fixed in `app/api/chat/route.ts`. Chat
history exists only in the current browser tab. Currai capture is best-effort:
timeouts or ingestion failures never fail the chat request.

Ask for current information or provide a URL to exercise the Exa MCP tools.
The route enables Exa's `web_search_exa` and `web_fetch_exa` tools and closes
the per-request MCP connection when the stream finishes or is aborted.
