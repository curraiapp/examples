import type { RetellVoice } from "../../assistant-config.ts";

type Fetcher = typeof fetch;

type HandlerOptions = {
  apiKey?: string;
  fetcher?: Fetcher;
};

function clean(value: unknown, maxLength = 256) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function listVoicesHandler(
  _request: Request,
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

  let upstream: Response;
  try {
    upstream = await (options.fetcher ?? fetch)(
      "https://api.retellai.com/list-voices",
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      },
    );
  } catch {
    return Response.json(
      { error: "Could not reach Retell. Check your network and try again." },
      { status: 502 },
    );
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    body = null;
  }

  if (!upstream.ok) {
    const candidate = body as Record<string, unknown> | null;
    const message = clean(candidate?.message) || clean(candidate?.error);
    return Response.json(
      { error: message || "Retell could not list voices." },
      { status: upstream.status >= 500 ? 502 : upstream.status },
    );
  }

  if (!Array.isArray(body)) {
    return Response.json(
      { error: "Retell returned an invalid voice list." },
      { status: 502 },
    );
  }

  const voices = body
    .map((item): RetellVoice | null => {
      if (!item || typeof item !== "object") return null;
      const voice = item as Record<string, unknown>;
      const id = clean(voice.voice_id);
      const name = clean(voice.voice_name);
      if (!id || !name) return null;
      return {
        id,
        name,
        provider: clean(voice.provider, 80) || "Retell",
        gender: clean(voice.gender, 40),
        accent: clean(voice.accent, 80),
        previewUrl: clean(voice.preview_audio_url, 2_048) || null,
      };
    })
    .filter((voice): voice is RetellVoice => voice !== null)
    .sort((left, right) => left.name.localeCompare(right.name));

  return Response.json({ voices });
}
