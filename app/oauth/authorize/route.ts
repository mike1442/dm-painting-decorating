import { handleAuthorizeGet, handleAuthorizePost } from "@/lib/chatgpt/oauth";
export const dynamic = "force-dynamic";
// The page Mike sees once when connecting ChatGPT: sign in and approve.
export const GET = (request: Request) => handleAuthorizeGet(request);
export const POST = (request: Request) => handleAuthorizePost(request);
