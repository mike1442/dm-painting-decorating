import type { Metadata } from "next";
import { AuthFrame } from "@/components/admin/AuthFrame";
import { PasswordForm } from "@/components/admin/PasswordForm";
import { requireAdmin } from "@/lib/admin/session";

export const metadata: Metadata = { title: "Change password" };

export default async function PasswordPage() {
  const user = await requireAdmin("/admin/password");
  return (
    <AuthFrame title="Set a new password">
      <PasswordForm email={user.email} />
    </AuthFrame>
  );
}
