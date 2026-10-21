"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { createQuote } from "@/lib/admin/operations";
import { clock, commit, useAdminState } from "@/lib/admin/store";

export function QuickQuote({ initialName, initialAmount, initialDescription }: {
  initialName: string; initialAmount: string; initialDescription: string;
}) {
  const router = useRouter();
  const state = useAdminState();
  const [name, setName] = useState(initialName);
  const [amount, setAmount] = useState(initialAmount);
  const [description, setDescription] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const pounds = Number(amount);
  const valid = name.trim().length > 0 && description.trim().length > 0 &&
    /^\d+(?:\.\d{1,2})?$/.test(amount.trim()) && Number.isFinite(pounds) && pounds > 0 && pounds <= 1000000;

  const create = () => {
    if (!valid || !state || saving || state.persistence === "failed" || state.persistence === "conflict") return;
    setSaving(true);
    let id = "";
    commit(data => {
      const result = createQuote(data, clock(), {
        title: description.trim().slice(0, 120),
        customer: { name: name.trim(), email: "", phone: "",
          address: { line1: "", line2: "", town: "", postcode: "" } },
        works: [{ description: description.trim(), quantity: 1, unit: "job", unitPrice: Math.round(pounds * 100) }],
        vat: { enabled: false, rate: 0 },
        source: "manual",
      });
      id = result.quote.id;
      return result.data;
    }, { immediate: true });
    router.push("/admin/quotes/" + id);
  };

  return <main className="mx-auto max-w-xl space-y-5 p-5">
    <Link className="text-sm underline" href="/admin/quotes">← Back to quotations</Link>
    <h1 className="text-2xl font-bold">Quick quotation</h1>
    <p>Check the details below, then create a draft. Nothing is sent to the customer.</p>
    {!state ? <p>Loading admin…</p> : <>
      <label className="block font-semibold">Customer name
        <input className="mt-2 w-full rounded-lg border p-3" value={name} onChange={e => setName(e.target.value)} />
      </label>
      <label className="block font-semibold">Work description
        <textarea className="mt-2 w-full rounded-lg border p-3" rows={4} value={description} onChange={e => setDescription(e.target.value)} />
      </label>
      <label className="block font-semibold">Total price (£), no VAT
        <input className="mt-2 w-full rounded-lg border p-3" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
      </label>
      <p className="text-sm">Cloud save status: {state.persistence}. Open the draft afterwards to confirm it has saved.</p>
      <button type="button" disabled={!valid || saving || state.persistence === "failed" || state.persistence === "conflict"}
        onClick={create} className="w-full rounded-xl bg-slate-900 p-4 font-semibold text-white disabled:opacity-40">
        {saving ? "Opening draft…" : "Create draft quotation"}
      </button>
    </>}
  </main>;
}
