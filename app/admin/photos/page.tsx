import type { Metadata } from "next";
import { PhotoLibrary } from "@/components/admin/PhotoLibrary";

export const metadata: Metadata = { title: "Photos" };

export default function PhotosPage() {
  return <PhotoLibrary />;
}
