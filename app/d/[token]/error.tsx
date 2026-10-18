"use client";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import "./shared-document.css";

const RETRY_MS = 5000;

/** Shown when the document service did not answer; it never reveals whether the link is valid. */
export default function SharedDocumentError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const retry = () => startTransition(() => { router.refresh(); reset(); });
  useEffect(() => {
    const timer = setTimeout(retry, RETRY_MS);
    return () => clearTimeout(timer);
  });
  return (
    <main className="dm-shared-document">
      <section className="dm-shared-unavailable">
        <p>D&amp;M Painting &amp; Decorating</p>
        <h1>Your document could not be loaded just now</h1>
        <p role="status">Our secure document service did not respond. This page tries again automatically.</p>
        <p><button type="button" onClick={retry}>Try again now</button></p>
      </section>
    </main>
  );
}
