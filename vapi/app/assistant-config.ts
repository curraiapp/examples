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
    firstMessage: "Hi! Tell me what you're hoping to improve, and I'll point you in the right direction.",
    systemPrompt:
      "You are a consultative sales guide. Learn the caller's current workflow, pain, urgency, and decision criteria before recommending anything. Be curious rather than pushy. Summarize the fit in plain language and end with one useful next step. Never fabricate pricing, features, or customer claims.",
  },
  {
    id: "appointments",
    label: "Appointment booking",
    eyebrow: "Schedule",
    description: "Collects booking details and confirms them back clearly.",
    name: "Studio Scheduler",
    firstMessage: "Hello! I can help plan your appointment. What would you like to book?",
    systemPrompt:
      "You are an appointment scheduling assistant. Collect the service, preferred date, preferred time, timezone, name, and contact details one item at a time. Repeat the complete request for confirmation. This demo cannot access a real calendar, so never claim an appointment is confirmed; explain that the request is ready for staff review.",
  },
] as const;

export const VAPI_VOICES = [
  { id: "Elliot", label: "Elliot", tone: "Warm · grounded", color: "#ff6b45", version: 2 },
  { id: "Savannah", label: "Savannah", tone: "Direct · polished", color: "#d7ff43", version: 2 },
  { id: "Rohan", label: "Rohan", tone: "Bright · energetic", color: "#80bfff" },
  { id: "Emma", label: "Emma", tone: "Warm · conversational", color: "#ffa6c9", version: 2 },
  { id: "Clara", label: "Clara", tone: "Warm · professional", color: "#d7b7ff", version: 2 },
  { id: "Nico", label: "Nico", tone: "Casual · natural", color: "#f2d27c", version: 2 },
] as const;

export type TemplateId = (typeof ASSISTANT_TEMPLATES)[number]["id"];
export type VoiceId = (typeof VAPI_VOICES)[number]["id"];

export type AssistantForm = {
  name: string;
  templateId: TemplateId;
  systemPrompt: string;
  firstMessage: string;
  voiceId: VoiceId;
};

export type CreatedAssistant = {
  id: string;
  name: string;
  createdAt: string | null;
  configuration: {
    templateId: TemplateId;
    voiceId: VoiceId;
    model: "gpt-4.1-mini";
    transcriber: "nova-3";
  };
};

const TEMPLATE_IDS = new Set<string>(
  ASSISTANT_TEMPLATES.map((template) => template.id),
);
const VOICE_IDS = new Set<string>(VAPI_VOICES.map((voice) => voice.id));

export function cloneTemplate(
  templateId: TemplateId,
  voiceId: VoiceId = "Elliot",
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
  const voiceId = candidate.voiceId;

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
  if (typeof voiceId !== "string" || !VOICE_IDS.has(voiceId)) {
    return { ok: false, error: "Select a supported Vapi voice." };
  }

  return {
    ok: true,
    value: {
      name,
      systemPrompt,
      firstMessage,
      templateId: templateId as TemplateId,
      voiceId: voiceId as VoiceId,
    },
  };
}

export function buildVapiAssistantPayload(form: AssistantForm) {
  const selectedVoice = VAPI_VOICES.find((voice) => voice.id === form.voiceId);

  return {
    name: form.name,
    firstMessage: form.firstMessage,
    firstMessageMode: "assistant-speaks-first",
    firstMessageInterruptionsEnabled: false,
    model: {
      provider: "openai",
      model: "gpt-4.1-mini",
      messages: [{ role: "system", content: form.systemPrompt }],
      temperature: 0.4,
      maxTokens: 250,
    },
    transcriber: {
      provider: "deepgram",
      model: "nova-3",
      language: "en",
    },
    voice: {
      provider: "vapi",
      voiceId: form.voiceId,
      ...(selectedVoice && "version" in selectedVoice
        ? { version: selectedVoice.version }
        : {}),
    },
    clientMessages: ["transcript", "status-update", "speech-update"],
    backgroundSound: "off",
  } as const;
}
