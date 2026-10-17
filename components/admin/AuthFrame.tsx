import { BrandLogo } from "@/components/documents/BrandLogo";

/** Centred card used by the sign-in and password pages. */
export function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="adm adm-auth">
      <main className="adm-auth-card">
        <div className="adm-auth-brand">
          <BrandLogo tone="light" />
          <span>Admin</span>
        </div>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}
