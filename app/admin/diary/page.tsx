import type { Metadata } from "next";
import { Suspense } from "react";
import { Diary } from "@/components/admin/Diary";
import { Loading } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Diary" };

export default function DiaryPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Diary />
    </Suspense>
  );
}
