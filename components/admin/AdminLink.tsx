"use client";
import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * Every admin route is checked with Supabase Auth by the middleware, so a
 * prefetched link costs two upstream calls. Lists render a link per record,
 * which made each page view fire dozens of checks for routes Mike may never
 * open. Admin links therefore load on use only.
 */
export default function AdminLink(props: ComponentProps<typeof Link>) {
  return <Link prefetch={false} {...props} />;
}
