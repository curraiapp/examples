import {
  OPENAI_REALTIME_MODEL,
  type CreatedAssistant,
  validateAssistantForm,
} from "../../assistant-config.ts";

type HandlerOptions = {
  apiKey?: string;
  createId?: () => string;
  now?: () => Date;
};

export async function createAssistantHandler(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      {
        error:
          "OPENAI_API_KEY is not configured. Add it to .env.local and restart the app.",
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

  const assistant: CreatedAssistant = {
    id: (options.createId ?? crypto.randomUUID)(),
    name: validation.value.name,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    configuration: {
      ...validation.value,
      model: OPENAI_REALTIME_MODEL,
    },
  };

  return Response.json({ assistant }, { status: 201 });
}
