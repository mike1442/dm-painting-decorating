import { authorizationServerMetadata } from "@/lib/chatgpt/oauth";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => authorizationServerMetadata(request);
