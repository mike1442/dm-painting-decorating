import { emptyBank, emptyCustomer, newId, newLineItem } from "./factories.ts";
import { addDays } from "./dates.ts";
import type { Clock } from "./operations.ts";
import type { Invoice } from "./types.ts";

/** Pure example fixture: nothing is saved, shared, sent or issued by calling it. */
export function billGatesTestInvoice(clock: Clock): Invoice {
  const id = newId();
  return {
    kind: "invoice",
    id,
    number: `TEST-${id.slice(0, 8).toUpperCase()}`,
    isTest: true,
    status: "draft",
    title: "Painting a 20m² wall",
    customer: { ...emptyCustomer(), name: "Bill Gates" },
    issueDate: clock.today,
    dueDate: addDays(clock.today, 14),
    quoteId: null,
    quoteNumber: "",
    scope: ["Prepare and paint a 20m² wall."],
    works: [
      newLineItem({ description: "Painter 1", quantity: 3, unit: "days", unitPrice: 250 }),
      newLineItem({ description: "Painter 2", quantity: 3, unit: "days", unitPrice: 250 }),
    ],
    materials: [newLineItem({ description: "Materials", quantity: 1, unit: "", unitPrice: 180 })],
    materialsNote: "",
    vat: { enabled: false, rate: 20 },
    payments: [],
    bank: emptyBank(),
    paymentNote: "",
    internalNotes: "Test example only. Not issued to a customer. No payment is due.",
    share: { token: null, status: "not-available" },
    createdAt: clock.now,
    updatedAt: clock.now,
  };
}
