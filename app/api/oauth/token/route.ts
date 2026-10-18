import { handleToken } from "@/lib/chatgpt/oauth";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleToken(request);
