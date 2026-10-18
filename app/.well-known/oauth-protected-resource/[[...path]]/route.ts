import { protectedResourceMetadata } from "@/lib/chatgpt/oauth";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  return protectedResourceMetadata(request, path.length ? `/${path.join("/")}` : "");
}
