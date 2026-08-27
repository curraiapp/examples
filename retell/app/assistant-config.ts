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

export type TemplateId = (typeof ASSISTANT_TEMPLATES)[number]["id"];

export type RetellVoice = {
  id: string;
  name: string;
  provider: string;
  gender: string;
  accent: string;
  previewUrl: string | null;
};

export type AssistantForm = {
  name: string;
  templateId: TemplateId;
  systemPrompt: string;
  firstMessage: string;
  voiceId: string;
};

export type CreatedAssistant = {
  id: string;
  llmId: string;
  name: string;
  createdAt: string | null;
  configuration: {
    templateId: TemplateId;
    voiceId: string;
    model: "gpt-4.1-mini";
  };
};

const TEMPLATE_IDS = new Set<string>(
  ASSISTANT_TEMPLATES.map((template) => template.id),
);
const RETELL_ID_PATTERN = /^[A-Za-z0-9_-]{2,256}$/;

export function cloneTemplate(
  templateId: TemplateId,
  voiceId = "",
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

export function isRetellId(value: unknown): value is string {
  return typeof value === "string" && RETELL_ID_PATTERN.test(value);
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
  const voiceId =
    typeof candidate.voiceId === "string" ? candidate.voiceId.trim() : "";

  if (name.length < 2 || name.length > 40) {
    return { ok: false, error: "Agent name must be 2–40 characters." };
  }
  if (systemPrompt.length < 20 || systemPrompt.length > 10_000) {
    return { ok: false, error: "System prompt must be 20–10,000 characters." };
  }
  if (firstMessage.length < 2 || firstMessage.length > 1_000) {
    return { ok: false, error: "First message must be 2–1,000 characters." };
  }
  if (typeof templateId !== "string" || !TEMPLATE_IDS.has(templateId)) {
    return { ok: false, error: "Select a supported agent template." };
  }
  if (!isRetellId(voiceId)) {
    return { ok: false, error: "Select a supported Retell voice." };
  }

  return {
    ok: true,
    value: {
      name,
      systemPrompt,
      firstMessage,
      templateId: templateId as TemplateId,
      voiceId,
    },
  };
}

export function buildRetellLlmPayload(form: AssistantForm) {
  return {
    model: "gpt-4.1-mini",
    model_temperature: 0.4,
    start_speaker: "agent",
    begin_message: form.firstMessage,
    general_prompt: form.systemPrompt,
  } as const;
}

export function buildRetellAgentPayload(form: AssistantForm, llmId: string) {
  return {
    agent_name: form.name,
    response_engine: {
      type: "retell-llm",
      llm_id: llmId,
    },
    voice_id: form.voiceId,
    language: "en-US",
    ambient_sound: null,
  } as const;
}
