import {
  buildRetellAgentPayload,
  buildRetellLlmPayload,
  type CreatedAssistant,
  validateAssistantForm,
} from "../../assistant-config.ts";

type Fetcher = typeof fetch;

type HandlerOptions = {
  apiKey?: string;
  fetcher?: Fetcher;
};

type JsonObject = Record<string, unknown>;

function upstreamMessage(body: JsonObject | null, fallback: string) {
  if (typeof body?.message === "string" && body.message) return body.message;
  if (typeof body?.error === "string" && body.error) return body.error;
  return fallback;
}

async function jsonObject(response: Response): Promise<JsonObject | null> {
  try {
    const body = (await response.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as JsonObject)
      : null;
  } catch {
    return null;
  }
}

export async function createAssistantHandler(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const apiKey = options.apiKey ?? process.env.RETELL_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "RETELL_API_KEY is not configured. Add it to .env.local and restart the app.",
      },
      { status: 500 },
    );
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const validation = validateAssistantForm(input);
  if (!validation.ok) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  const fetcher = options.fetcher ?? fetch;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  let llmResponse: Response;
  try {
    llmResponse = await fetcher("https://api.retellai.com/create-retell-llm", {
      method: "POST",
      headers,
      body: JSON.stringify(buildRetellLlmPayload(validation.value)),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Could not reach Retell. Check your network and try again." },
      { status: 502 },
    );
  }

  const llmBody = await jsonObject(llmResponse);
  if (!llmResponse.ok) {
    return Response.json(
      { error: upstreamMessage(llmBody, "Retell could not create the LLM.") },
      { status: llmResponse.status >= 500 ? 502 : llmResponse.status },
    );
  }

  const llmId = typeof llmBody?.llm_id === "string" ? llmBody.llm_id : "";
  if (!llmId) {
    return Response.json(
      { error: "Retell returned an invalid LLM response without an ID." },
      { status: 502 },
    );
  }

  let agentResponse: Response;
  try {
    agentResponse = await fetcher("https://api.retellai.com/create-agent", {
      method: "POST",
      headers,
      body: JSON.stringify(buildRetellAgentPayload(validation.value, llmId)),
      cache: "no-store",
    });
  } catch {
    await cleanupLlm(fetcher, headers, llmId);
    return Response.json(
      { error: "Could not reach Retell while creating the voice agent." },
      { status: 502 },
    );
  }

  const agentBody = await jsonObject(agentResponse);
  if (!agentResponse.ok) {
    await cleanupLlm(fetcher, headers, llmId);
    return Response.json(
      {
        error: upstreamMessage(
          agentBody,
          "Retell could not create the voice agent.",
        ),
      },
      { status: agentResponse.status >= 500 ? 502 : agentResponse.status },
    );
  }

  const agentId =
    typeof agentBody?.agent_id === "string" ? agentBody.agent_id : "";
  if (!agentId) {
    await cleanupLlm(fetcher, headers, llmId);
    return Response.json(
      { error: "Retell returned an invalid agent response without an ID." },
      { status: 502 },
    );
  }

  const modifiedAt = agentBody?.last_modification_timestamp;
  const assistant: CreatedAssistant = {
    id: agentId,
    llmId,
    name:
      typeof agentBody?.agent_name === "string" && agentBody.agent_name
        ? agentBody.agent_name
        : validation.value.name,
    createdAt:
      typeof modifiedAt === "number" && Number.isFinite(modifiedAt)
        ? new Date(modifiedAt).toISOString()
        : null,
    configuration: {
      templateId: validation.value.templateId,
      voiceId: validation.value.voiceId,
      model: "gpt-4.1-mini",
    },
  };

  return Response.json({ assistant }, { status: 201 });
}

async function cleanupLlm(
  fetcher: Fetcher,
  headers: Record<string, string>,
  llmId: string,
) {
  try {
    await fetcher(
      `https://api.retellai.com/delete-retell-llm/${encodeURIComponent(llmId)}`,
      { method: "DELETE", headers, cache: "no-store" },
    );
  } catch {
    // Cleanup is best-effort; preserve the original creation failure.
  }
}
