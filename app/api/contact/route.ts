import { handleContactRequest } from "../../../lib/server/contact";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleContactRequest(request);
}
