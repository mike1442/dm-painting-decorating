import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/admin/auth";
import { serverSupabase } from "@/lib/supabase/server";

// Landing point for links in Supabase emails (password reset). Exchanges the
// one-time code for a session, then continues to an admin page.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const supabase = await serverSupabase();
  let ok = false;
  if (supabase && !params.get("error")) {
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
    else if (tokenHash && type) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  }
  return NextResponse.redirect(new URL(ok ? next : "/admin/login?error=link", request.url));
}
