import { createOpenAI } from "@ai-sdk/openai";
import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
} from "ai";
import {
  captureCurraiEvent,
  captureCurraiSession,
} from "../../../lib/currai";

export const maxDuration = 30;

const SYSTEM_PROMPT = `You are a helpful, clear, and thoughtful assistant.
Answer the user's question directly. Use concise explanations by default, add
detail when it improves understanding, and say when you are uncertain. Use the
Exa tools when the user asks for current information, web research, or content
from a URL. Cite the source URLs in answers that use Exa.`;

const EXA_MCP_URL =
  "https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa";

export async function POST(request: Request): Promise<Response> {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json(
      { error: "OPENAI_API_KEY is not configured" },
      { status: 500 },
    );
  }

  let body: { messages?: UIMessage[]; sessionId?: string };
  try {
    body = (await request.json()) as {
      messages?: UIMessage[];
      sessionId?: string;
    };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages must be an array" }, { status: 400 });
  }

  if (!body.sessionId || !isUuid(body.sessionId)) {
    return Response.json(
      { error: "sessionId must be a UUID" },
      { status: 400 },
    );
  }

  const sessionId = body.sessionId;
  const agentEventId = crypto.randomUUID();
  const modelEventId = crypto.randomUUID();
  const startedAt = Date.now();
  const modelId = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV || "development";
  const release = process.env.VERCEL_GIT_COMMIT_SHA;

  const sessionInput = {
    sessionId,
    userId: `chat:${sessionId}`,
    metadata: {
      route: "/api/chat",
      runtime: "nextjs",
      environment,
      ...(release ? { release } : {}),
    },
  };
  let sessionAccepted = await captureCurraiSession(sessionInput);

  async function ensureCurraiSession(): Promise<boolean> {
    if (!sessionAccepted) {
      sessionAccepted = await captureCurraiSession(sessionInput);
    }
    return sessionAccepted;
  }

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const exaHeaders = process.env.EXA_API_KEY
    ? { "x-api-key": process.env.EXA_API_KEY }
    : undefined;
  let exaClient: Awaited<ReturnType<typeof createMCPClient>> | undefined;
  let exaClosed = false;
  const toolRuns = new Map<
    string,
    { eventId: string; startedAt: number }
  >();

  async function closeExaClient(): Promise<void> {
    if (!exaClient || exaClosed) return;
    exaClosed = true;
    try {
      await exaClient.close();
    } catch (error) {
      console.warn("Could not close the Exa MCP client", error);
    }
  }

  let exaTools: ToolSet = {};
  try {
    exaClient = await createMCPClient({
      name: "currai-example-chatbot",
      version: "0.1.0",
      transport: {
        type: "http",
        url: EXA_MCP_URL,
        ...(exaHeaders ? { headers: exaHeaders } : {}),
      },
      onUncaughtError(error) {
        console.error("Exa MCP client error", error);
      },
    });
    const discoveredTools = await exaClient.tools();

    for (const tool of Object.values(discoveredTools)) {
      const onInputAvailable = tool.onInputAvailable;
      tool.onInputAvailable = async (options) => {
        toolRuns.set(options.toolCallId, {
          eventId: crypto.randomUUID(),
          startedAt: Date.now(),
        });
        await onInputAvailable?.(options);
      };
    }
    exaTools = discoveredTools as ToolSet;
  } catch (error) {
    await closeExaClient();
    console.error("Could not connect to Exa MCP", error);
    await captureCurraiEvent({
      eventId: crypto.randomUUID(),
      sessionId,
      sessionAccepted,
      parentId: agentEventId,
      kind: "mcp_tool",
      name: "exa.connect",
      args: { server: "mcp.exa.ai" },
      result: { error: errorMessage(error) },
      success: false,
      latency: Date.now() - startedAt,
      timestamp: startedAt,
      metadata: {
        route: "/api/chat",
        environment,
        ...(release ? { release } : {}),
      },
    });
  }
  let settled = false;

  async function captureFailure(error: unknown) {
    if (settled) return;
    settled = true;
    const latency = Date.now() - startedAt;
    const failure = {
      error: errorMessage(error),
    };
    await ensureCurraiSession();

    await Promise.all([
      captureCurraiEvent({
        eventId: modelEventId,
        sessionId,
        sessionAccepted,
        parentId: agentEventId,
        kind: "model",
        name: "openai.streamText",
        args: { messages: body.messages },
        result: failure,
        success: false,
        latency,
        timestamp: startedAt,
        metadata: {
          provider: "openai",
          model: modelId,
          route: "/api/chat",
          environment,
          ...(release ? { release } : {}),
        },
      }),
      captureCurraiEvent({
        eventId: agentEventId,
        sessionId,
        sessionAccepted,
        kind: "agent",
        name: "chat.turn",
        args: { messages: body.messages },
        result: failure,
        success: false,
        latency,
        timestamp: startedAt,
        metadata: {
          route: "/api/chat",
          environment,
          ...(release ? { release } : {}),
        },
      }),
    ]);
    await closeExaClient();
  }

  let result: ReturnType<typeof streamText>;
  try {
    result = streamText({
      model: openai(modelId),
      system: SYSTEM_PROMPT,
      messages: convertToModelMessages(body.messages),
      tools: exaTools,
      stopWhen: stepCountIs(5),
      async onError({ error }) {
        await captureFailure(error);
      },
      async onStepFinish(step) {
        const toolParts = step.content
          .filter(
            (part) =>
              part.type === "tool-result" || part.type === "tool-error",
          )
          .filter(
            (part) => part.type === "tool-error" || !part.preliminary,
          );

        await Promise.all(
          toolParts.map(async (part) => {
            const run = toolRuns.get(part.toolCallId) ?? {
              eventId: crypto.randomUUID(),
              startedAt: Date.now(),
            };
            const failed =
              part.type === "tool-error" ||
              (part.type === "tool-result" && isMcpError(part.output));
            const result =
              part.type === "tool-error"
                ? { error: errorMessage(part.error) }
                : part.output;

            await ensureCurraiSession();
            await captureCurraiEvent({
              eventId: run.eventId,
              sessionId,
              sessionAccepted,
              parentId: modelEventId,
              kind: "mcp_tool",
              name: `exa.${part.toolName}`,
              args: part.input,
              result,
              success: !failed,
              latency: Date.now() - run.startedAt,
              timestamp: run.startedAt,
              metadata: {
                server: "mcp.exa.ai",
                transport: "streamable-http",
                toolCallId: part.toolCallId,
                route: "/api/chat",
                environment,
                ...(release ? { release } : {}),
              },
            });
            toolRuns.delete(part.toolCallId);
          }),
        );
      },
      async onFinish({ text, finishReason, totalUsage }) {
        if (settled) return;
        settled = true;
        const latency = Date.now() - startedAt;
        const metadata = {
          provider: "openai",
          model: modelId,
          finishReason,
          tokens: totalUsage,
          route: "/api/chat",
          environment,
          ...(release ? { release } : {}),
        };
        await ensureCurraiSession();

        await captureCurraiEvent({
          eventId: modelEventId,
          sessionId,
          sessionAccepted,
          parentId: agentEventId,
          kind: "model",
          name: "openai.streamText",
          args: { messages: body.messages },
          result: { text },
          latency,
          timestamp: startedAt,
          metadata,
        });
        await captureCurraiEvent({
          eventId: agentEventId,
          sessionId,
          sessionAccepted,
          kind: "agent",
          name: "chat.turn",
          args: { messages: body.messages },
          result: { text },
          latency,
          timestamp: startedAt,
          metadata: {
            route: "/api/chat",
            environment,
            ...(release ? { release } : {}),
          },
        });
        await closeExaClient();
      },
      async onAbort() {
        await closeExaClient();
      },
    });
  } catch (error) {
    await captureFailure(error);
    throw error;
  }

  return result.toUIMessageStreamResponse({
    onError(error) {
      console.error("OpenAI stream failed", error);
      return "The assistant could not complete this response.";
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMcpError(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    result.isError === true
  );
}
