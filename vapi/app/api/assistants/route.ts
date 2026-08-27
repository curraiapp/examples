import { createAssistantHandler } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return createAssistantHandler(request);
}
