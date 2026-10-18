"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loading } from "./ui";

/** The admin opens directly on its first of three sections. */
export function AdminHome() {
  const router = useRouter();
  useEffect(() => { router.replace("/admin/quotes"); }, [router]);
  return <Loading />;
}
