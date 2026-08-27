import {
  buildVapiAssistantPayload,
  type CreatedAssistant,
  validateAssistantForm,
} from "../../assistant-config.ts";

type Fetcher = typeof fetch;

type HandlerOptions = {
  privateKey?: string;
  fetcher?: Fetcher;
};

type VapiAssistantResponse = {
  id?: unknown;
  name?: unknown;
  createdAt?: unknown;
  message?: unknown;
  error?: unknown;
};

function vapiErrorMessage(body: VapiAssistantResponse) {
  if (typeof body.message === "string" && body.message) return body.message;
  if (typeof body.error === "string" && body.error) return body.error;
  return "Vapi could not create the assistant.";
}

export async function createAssistantHandler(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const privateKey = options.privateKey ?? process.env.VAPI_PRIVATE_KEY?.trim();
  if (!privateKey) {
    return Response.json(
      {
        error:
          "VAPI_PRIVATE_KEY is not configured. Add it to .env.local and restart the app.",
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
  let upstream: Response;
  try {
    upstream = await fetcher("https://api.vapi.ai/assistant", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${privateKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildVapiAssistantPayload(validation.value)),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Could not reach Vapi. Check your network and try again." },
      { status: 502 },
    );
  }

  let body: VapiAssistantResponse = {};
  try {
    body = (await upstream.json()) as VapiAssistantResponse;
  } catch {
    // A non-JSON upstream response is handled by the status and safe fallback.
  }

  if (!upstream.ok) {
    return Response.json(
      { error: vapiErrorMessage(body) },
      { status: upstream.status >= 500 ? 502 : upstream.status },
    );
  }

  if (typeof body.id !== "string" || !body.id) {
    return Response.json(
      { error: "Vapi created an invalid assistant response without an ID." },
      { status: 502 },
    );
  }

  const assistant: CreatedAssistant = {
    id: body.id,
    name:
      typeof body.name === "string" && body.name
        ? body.name
        : validation.value.name,
    createdAt: typeof body.createdAt === "string" ? body.createdAt : null,
    configuration: {
      templateId: validation.value.templateId,
      voiceId: validation.value.voiceId,
      model: "gpt-4.1-mini",
      transcriber: "nova-3",
    },
  };

  return Response.json({ assistant }, { status: 201 });
}
