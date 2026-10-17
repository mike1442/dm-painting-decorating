import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase/server";

// Server-side check used by admin layouts and pages, behind middleware.ts. The
// user is confirmed with Supabase Auth and membership with the database, so
// hiding links or noindex headers are never what keeps the admin private.

export type AdminUser = { id: string; email: string };

export type AdminSession =
  | { status: "not-configured" }
  | { status: "signed-out" }
  | { status: "not-member"; email: string }
  | { status: "check-failed"; email: string }
  | { status: "member"; user: AdminUser };

export async function getAdminSession(): Promise<AdminSession> {
  const supabase = await serverSupabase();
  if (!supabase) return { status: "not-configured" };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { status: "signed-out" };
  const email = data.user.email ?? "";
  const { data: member, error: memberError } = await supabase.rpc("dm_admin_is_member");
  if (memberError) return { status: "check-failed", email };
  if (member !== true) return { status: "not-member", email };
  return { status: "member", user: { id: data.user.id, email } };
}

/** Returns the signed-in admin member, or redirects to the sign-in page. */
export async function requireAdmin(next = "/admin"): Promise<AdminUser> {
  const session = await getAdminSession();
  if (session.status === "member") return session.user;
  if (session.status === "not-member") redirect("/admin/login?error=not-authorised");
  if (session.status === "check-failed") redirect("/admin/login?error=check-failed");
  redirect(`/admin/login?next=${encodeURIComponent(next)}`);
}
