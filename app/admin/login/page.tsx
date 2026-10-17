import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/admin/AuthFrame";
import { LoginPanel } from "@/components/admin/LoginPanel";
import { safeNext } from "@/lib/admin/auth";
import { getAdminSession } from "@/lib/admin/session";

export const metadata: Metadata = { title: "Sign in" };

const notices: Record<string, string> = {
  "not-authorised": "That account isn't set up for the D&M admin.",
  "check-failed": "We couldn't confirm your access. Check your connection and try again.",
  link: "That link has expired or has already been used. Request a new one below.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const session = await getAdminSession();
  if (session.status === "member") redirect(next);
  const notice = params["signed-out"] ? "You've signed out." : params.error ? (notices[params.error] ?? "") : "";
  return (
    <AuthFrame title="Sign in">
      <LoginPanel
        configured={session.status !== "not-configured"}
        next={next}
        notice={notice}
        signedInAs={session.status === "not-member" || session.status === "check-failed" ? session.email : ""}
      />
    </AuthFrame>
  );
}
