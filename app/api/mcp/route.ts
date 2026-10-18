import { handleMcpGet, handleMcpOther, handleMcpPost } from "@/lib/chatgpt/mcp";
export const dynamic = "force-dynamic";
// Mike's private ChatGPT connection (MCP over Streamable HTTP). See docs/chatgpt.md.
export const POST = (request: Request) => handleMcpPost(request);
export const GET = (request: Request) => handleMcpGet(request);
export const DELETE = () => handleMcpOther();

