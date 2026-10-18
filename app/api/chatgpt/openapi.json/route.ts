import { openApiDocument } from "@/lib/chatgpt/mcp";
export const dynamic = "force-dynamic";
// Import this into a Custom GPT's Actions (the alternative to the MCP app).
export const GET = (request: Request) => openApiDocument(request);
