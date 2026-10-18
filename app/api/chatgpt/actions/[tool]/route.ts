import { handleAction } from "@/lib/chatgpt/mcp";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ tool: string }> }) {
  return handleAction(request, (await params).tool);
}
