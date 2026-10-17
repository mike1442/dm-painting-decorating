import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdmin } from "@/lib/admin/session";

// Every page in this group is for signed-in admin members only.
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return <AdminShell user={user}>{children}</AdminShell>;
}
