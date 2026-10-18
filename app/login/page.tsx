import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";
import "../admin/admin.css";
export const metadata: Metadata = { title: "Admin sign in | D&M", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function LoginPage() { return <LoginForm />; }
