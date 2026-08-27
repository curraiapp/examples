import { captureVoiceHandler } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return captureVoiceHandler(request);
}
