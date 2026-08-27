export const OPENAI_REALTIME_MODEL = "gpt-realtime-2.1" as const;
export const OPENAI_TRANSCRIPTION_MODEL = "gpt-transcribe" as const;

export const ASSISTANT_TEMPLATES = [
  {
    id: "general",
    label: "General assistant",
    eyebrow: "Flexible",
    description: "A concise, capable assistant for everyday questions.",
    name: "Studio Generalist",
    firstMessage: "Hi, I'm ready. What would you like to work on?",
    systemPrompt:
      "You are a clear, thoughtful voice assistant. Answer directly, keep responses conversational, and ask one focused follow-up question when you need more context. Keep most responses under 60 words so they sound natural when spoken.",
  },
  {
    id: "support",
    label: "Customer support",
    eyebrow: "Resolve",
    description: "Diagnoses issues and guides customers to a clear resolution.",
    name: "Studio Support",
    firstMessage: "Hi, you've reached support. What can I help you fix today?",
    systemPrompt:
      "You are a patient customer support specialist. First understand the customer's goal and symptoms, then guide them through one step at a time. Confirm whether each step worked before continuing. Never invent account details, policies, or completed actions. Escalate clearly when human help is required.",
  },
  {
    id: "sales",
    label: "Sales guide",
    eyebrow: "Discover",
    description: "Qualifies interest without sounding scripted or pushy.",
    name: "Studio Sales Guide",
    firstMessage:
      "Hi! Tell me what you're hoping to improve, and I'll point you in the right direction.",
    systemPrompt:
      "You are a consultative sales guide. Learn the caller's current workflow, pain, urgency, and decision criteria before recommending anything. Be curious rather than pushy. Summarize the fit in plain language and end with one useful next step. Never fabricate pricing, features, or customer claims.",
  },
  {
    id: "appointments",
    label: "Appointment booking",
    eyebrow: "Schedule",
    description: "Collects booking details and confirms them back clearly.",
    name: "Studio Scheduler",
    firstMessage:
      "Hello! I can help plan your appointment. What would you like to book?",
    systemPrompt:
      "You are an appointment scheduling assistant. Collect the service, preferred date, preferred time, timezone, name, and contact details one item at a time. Repeat the complete request for confirmation. This demo cannot access a real calendar, so never claim an appointment is confirmed; explain that the request is ready for staff review.",
  },
] as const;

export const OPENAI_VOICES = [
  { id: "marin", name: "Marin", description: "Warm and natural" },
  { id: "cedar", name: "Cedar", description: "Clear and composed" },
  { id: "coral", name: "Coral", description: "Friendly and expressive" },
  { id: "sage", name: "Sage", description: "Calm and measured" },
  { id: "alloy", name: "Alloy", description: "Balanced and versatile" },
  { id: "verse", name: "Verse", description: "Confident and conversational" },
] as const;

export type TemplateId = (typeof ASSISTANT_TEMPLATES)[number]["id"];
export type OpenAIVoiceId = (typeof OPENAI_VOICES)[number]["id"];

export type AssistantForm = {
  name: string;
  templateId: TemplateId;
  systemPrompt: string;
  firstMessage: string;
  voiceId: OpenAIVoiceId;
};

export type CreatedAssistant = {
  id: string;
  name: string;
  createdAt: string;
  configuration: AssistantForm & {
    model: typeof OPENAI_REALTIME_MODEL;
  };
};

const TEMPLATE_IDS = new Set<string>(
  ASSISTANT_TEMPLATES.map((template) => template.id),
);
const VOICE_IDS = new Set<string>(OPENAI_VOICES.map((voice) => voice.id));

export function cloneTemplate(
  templateId: TemplateId,
  voiceId: OpenAIVoiceId = "marin",
): AssistantForm {
  const template = ASSISTANT_TEMPLATES.find((item) => item.id === templateId);
  if (!template) throw new Error("Unknown assistant template.");
  return {
    name: template.name,
    templateId: template.id,
    systemPrompt: template.systemPrompt,
    firstMessage: template.firstMessage,
    voiceId,
  };
}

type ValidationResult =
  | { ok: true; value: AssistantForm }
  | { ok: false; error: string };

export function isOpenAIVoiceId(value: unknown): value is OpenAIVoiceId {
  return typeof value === "string" && VOICE_IDS.has(value);
}

export function validateAssistantForm(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Request body must be an object." };
  }
  const candidate = input as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const systemPrompt =
    typeof candidate.systemPrompt === "string"
      ? candidate.systemPrompt.trim()
      : "";
  const firstMessage =
    typeof candidate.firstMessage === "string"
      ? candidate.firstMessage.trim()
      : "";
  const templateId = candidate.templateId;

  if (name.length < 2 || name.length > 40) {
    return { ok: false, error: "Assistant name must be 2–40 characters." };
  }
  if (systemPrompt.length < 20 || systemPrompt.length > 10_000) {
    return { ok: false, error: "System prompt must be 20–10,000 characters." };
  }
  if (firstMessage.length < 2 || firstMessage.length > 1_000) {
    return { ok: false, error: "First message must be 2–1,000 characters." };
  }
  if (typeof templateId !== "string" || !TEMPLATE_IDS.has(templateId)) {
    return { ok: false, error: "Select a supported assistant template." };
  }
  if (!isOpenAIVoiceId(candidate.voiceId)) {
    return { ok: false, error: "Select a supported OpenAI voice." };
  }

  return {
    ok: true,
    value: {
      name,
      systemPrompt,
      firstMessage,
      templateId: templateId as TemplateId,
      voiceId: candidate.voiceId,
    },
  };
}

export function buildRealtimeSession(form: AssistantForm) {
  return {
    type: "realtime",
    model: OPENAI_REALTIME_MODEL,
    instructions: form.systemPrompt,
    output_modalities: ["audio"],
    max_output_tokens: 1_024,
    audio: {
      input: {
        transcription: { model: OPENAI_TRANSCRIPTION_MODEL },
        turn_detection: {
          type: "server_vad",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: form.voiceId },
    },
  } as const;
}
