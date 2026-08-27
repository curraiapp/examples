import { demoToolsHandler } from "./handler";

export async function POST(request: Request): Promise<Response> {
  return demoToolsHandler(request);
}
