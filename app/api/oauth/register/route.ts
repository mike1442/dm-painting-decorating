import { handleRegister } from "@/lib/chatgpt/oauth";
export const dynamic = "force-dynamic";
export const POST = (request: Request) => handleRegister(request);
