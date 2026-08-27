import { createAssistantHandler } from "./handler";

export async function POST(request: Request) {
  return createAssistantHandler(request);
}
