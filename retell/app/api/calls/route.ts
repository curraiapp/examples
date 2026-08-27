import { createCallHandler } from "./handler";

export async function POST(request: Request) {
  return createCallHandler(request);
}
