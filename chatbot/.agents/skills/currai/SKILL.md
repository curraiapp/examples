---
name: currai
description: Connect a TypeScript, JavaScript, or Python AI application to Currai's user intelligence and agent quality platform without a Currai SDK. Use when instrumenting a chatbot, agent, MCP server, model call, tool, retriever, guardrail, or evaluator so Currai can derive User Stories, Intents, Violations, Alerts, Errors, Auto Improve proposals, traces, and evaluation evidence.
---

# Currai application integration

Work from the target application root. Use native HTTP capture only; never
install or create a first-party Currai SDK.

## Customer contract

Keep the customer experience to one action: install this skill and ask the
coding agent to connect the application with credentials already stored in the
server environment. Run detection,
instrumentation, helper generation, connectivity checks, and verification
yourself. Do not ask the customer to run bundled scripts or manually create the
HTTP helper.

## Establish the target

Before editing, obtain only missing facts:

- an ingestion-only Currai public/secret key pair from Workspace Settings;
- the target package path when the repository is a monorepo;
- the real AI entrypoint: chat route, agent call, MCP startup, or tool handler;
- the application's normal local start command or production deployment path;
- whether verification will use the local application or a deployment.

Do not invent credentials or claim integration from a standalone example.

## Detect the application

Run the bundled detector yourself from this installed skill directory:

```bash
node "$SKILL_DIR/scripts/detect.mjs" --dir <app-path> --json
```

If it reports a monorepo root, rerun it with one of the returned package
candidates. Inspect the reported entrypoint candidates and confirm the real AI
path before editing.

## Configure API-first capture

Create the dependency-free helper and environment configuration yourself:

```bash
node "$SKILL_DIR/scripts/instrument.mjs" \
  --dir <app-path> \
  --public-key <public-key> \
  --secret-key <secret-key> \
  --mode <local|prod> \
  --env-mode <file|manual> \
  --json
```

The script must not overwrite existing environment values or unrelated source.
For deployment-managed variables, use `--env-mode manual` and configure:

```text
CURRAI_PUBLIC_KEY=<public-key>
CURRAI_SECRET_KEY=<secret-key>
CURRAI_BASE_URL=https://www.currai.app
```

Read only the matching section in `references/frameworks.md`, then wire the
generated helper into the confirmed entrypoint. Create one UUID session per
complete conversation or agent run. Await session creation before its first
event. Give each event a UUID and preserve nesting with `parent_id`.

Capture these boundaries when present:

- `agent` for orchestration or agent turns;
- `model` for provider calls;
- `tool` and `mcp_tool` for tool execution;
- `retriever` for retrieval;
- `guardrail` for policy checks;
- `evaluator` for quality judgments;
- `event` for other meaningful evidence.

Capture failures with `success: false`. Include model, provider, tokens, cost,
route, release, and environment metadata when available. Include `intent`,
`intents`, `violation`, or `violations` metadata only when the application
already knows those classifications; never fabricate matches.

Redact authorization headers, cookies, passwords, tokens, secrets, and
unnecessary personal data. Keep capture server-side, use a short timeout, and
never fail the product request because Currai is unavailable.

## Check connectivity

Optionally validate the workspace and capture endpoints:

```bash
node "$SKILL_DIR/scripts/send-demo.mjs" \
  --public-key <public-key> \
  --secret-key <secret-key> \
  --base-url https://www.currai.app \
  --json
```

A successful demo proves endpoint connectivity only. It does not prove that the
customer application's real path is integrated.

## Definition of done

Complete the integration only after all of the following:

1. Restart or deploy the target application with its server-side environment.
2. Trigger one real chat, agent action, or MCP tool call through the application.
3. Confirm the real session in Currai Events and User Stories.
4. Confirm configured intents and violation rules match when the interaction
   contains their evidence.
5. Confirm failures appear in Errors, alert conditions can trigger, and the
   trace preserves model/tool nesting.

If the interaction is missing, inspect the application logs, environment
propagation, HTTP status, session ordering, and process lifetime. Fix only the
proven gap and repeat the same real interaction.

Report the detected framework, files changed, environment values required,
restart or deployment step, and the exact interaction used for verification.
