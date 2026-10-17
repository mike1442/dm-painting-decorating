import { amount, list, MAX_LINES, normaliseCustomer, normaliseDeposit, normaliseVat, obj, text, textList } from "./normalise.ts";
import type { QuoteInput } from "./operations.ts";
import type { Customer, LineItem } from "./types.ts";

// Structured quote input for the ChatGPT → D&M quotation workflow. Today the
// JSON is pasted into the admin; later the same shape can arrive through an
// authenticated API or a Custom GPT action.

export const quoteInputExample = {
  customer: {
    name: "Mrs J. Example",
    email: "",
    phone: "",
    address: { line1: "12 Example Road", line2: "", town: "Stockton Heath", postcode: "WA4 0AA" },
  },
  title: "Lounge and hallway redecoration",
  intro: "Thank you for showing us around. As discussed, this quotation covers the lounge, hallway and landing.",
  scope: [
    "Protect floors, furniture and fixtures throughout",
    "Fill and sand walls and ceilings, spot-prime repairs",
    "Two finish coats to walls and ceilings in the agreed colours",
  ],
  works: [{ description: "Lounge: walls and ceiling", quantity: 1, unit: "room", unitPrice: 0 }],
  materials: [{ description: "Paint, fillers and sundries", quantity: 1, unit: "allowance", unitPrice: 0 }],
  materialsNote: "",
  validForDays: 30,
  deposit: { type: "none", value: 0 },
};

/** JSON Schema of the accepted input, usable for a future ChatGPT action. */
export const quoteInputJsonSchema = {
  type: "object",
  required: ["customer", "title", "scope", "works"],
  properties: {
    customer: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        address: {
          type: "object",
          properties: { line1: { type: "string" }, line2: { type: "string" }, town: { type: "string" }, postcode: { type: "string" } },
        },
      },
    },
    title: { type: "string" },
    intro: { type: "string" },
    scope: { type: "array", items: { type: "string" } },
    works: { type: "array", items: { $ref: "#/$defs/line" } },
    materials: { type: "array", items: { $ref: "#/$defs/line" } },
    materialsNote: { type: "string" },
    terms: { type: "array", items: { type: "string" } },
    validForDays: { type: "integer", minimum: 1 },
    vat: { type: "object", properties: { enabled: { type: "boolean" }, rate: { type: "number" } } },
    deposit: { type: "object", properties: { type: { enum: ["none", "percent", "fixed"] }, value: { type: "number" } } },
  },
  $defs: {
    line: {
      type: "object",
      required: ["description", "quantity", "unitPrice"],
      properties: {
        description: { type: "string" },
        quantity: { type: "number" },
        unit: { type: "string" },
        unitPrice: { type: "number", description: "Pounds, excluding VAT" },
      },
    },
  },
} as const;

export const chatGptInstructions = `When I ask for the quote JSON, reply with one JSON code block only, using exactly this structure:

${JSON.stringify(quoteInputExample, null, 2)}

Rules:
- Use only prices I have given you. Never estimate or invent prices; use 0 where a price is unknown.
- unitPrice is in pounds per unit, excluding VAT. quantity can be a decimal.
- Only include "vat" or a deposit if I ask for them.
- Leave "terms" out to use D&M's standard terms.
- Use British English and keep descriptions concise and professional.`;

const POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

/** Accepts a structured address or a single string such as "12 Road, Town, WA4 0AA". */
function customerFrom(v: unknown): Customer {
  const raw = obj(v);
  if (typeof raw.address !== "string") return normaliseCustomer(raw);
  const parts = raw.address.split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
  const postcode = parts.length > 1 && POSTCODE.test(parts[parts.length - 1]) ? parts.pop()! : "";
  const town = parts.length > 1 ? parts.pop()! : "";
  const [line1 = "", ...rest] = parts;
  return normaliseCustomer({ ...raw, address: { line1, line2: rest.join(", "), town, postcode } });
}

function linesFrom(v: unknown): Omit<LineItem, "id">[] {
  return list(v)
    .slice(0, MAX_LINES)
    .map(item => {
      const l = obj(item);
      const description = text(l.description ?? l.name ?? l.item, 1000).trim();
      const quantity = amount(l.quantity ?? l.qty, 1);
      const price = l.unitPrice ?? l.price ?? l.rate;
      const unitPrice = price !== undefined ? amount(price) : amount(l.amount ?? l.total);
      return {
        description,
        quantity: price === undefined && (l.amount ?? l.total) !== undefined ? 1 : quantity,
        unit: text(l.unit, 30),
        unitPrice,
      };
    })
    .filter(line => line.description || line.unitPrice);
}

export type ParsedQuoteInput = { ok: true; input: QuoteInput; warnings: string[] } | { ok: false; error: string };

export function parseQuoteJson(pasted: string, defaultVatRate: number): ParsedQuoteInput {
  const start = pasted.indexOf("{");
  const end = pasted.lastIndexOf("}");
  if (start < 0 || end <= start) return { ok: false, error: "No JSON found. Paste the code block ChatGPT gave you." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(pasted.slice(start, end + 1));
  } catch {
    return { ok: false, error: "That JSON isn't valid. Ask ChatGPT to resend the quote as a single JSON code block." };
  }
  const outer = obj(parsed);
  const q = obj(outer.dmQuote ?? outer.quote ?? outer);
  const works = linesFrom(q.works ?? q.items ?? q.lineItems);
  const materials = linesFrom(q.materials);
  const title = text(q.title, 300).trim();
  if (!title && !works.length && !materials.length && !obj(q.customer).name) {
    return { ok: false, error: "This doesn't look like a quote. It needs a title, customer or priced items." };
  }

  const input: QuoteInput = {
    source: "chatgpt",
    customer: customerFrom(q.customer),
    title,
    scope: textList(q.scope),
    works,
    materials,
    materialsNote: text(q.materialsNote),
  };
  if (typeof q.intro === "string") input.intro = text(q.intro);
  if (q.terms !== undefined && textList(q.terms).length) input.terms = textList(q.terms);
  const days = Math.round(amount(q.validForDays, 0));
  if (days >= 1 && days <= 365) input.validForDays = days;
  if (q.vat !== undefined) input.vat = normaliseVat(q.vat, { enabled: false, rate: defaultVatRate });
  if (q.deposit !== undefined) input.deposit = normaliseDeposit(q.deposit);

  const warnings: string[] = [];
  const unpriced = [...works, ...materials].filter(line => !line.unitPrice).length;
  if (unpriced) warnings.push(`${unpriced} line${unpriced === 1 ? " has" : "s have"} no price yet. Add prices before sending.`);
  if (!input.customer?.name) warnings.push("No customer name was included.");
  if (!works.length) warnings.push("No itemised works were included.");
  if (input.vat?.enabled) warnings.push(`VAT at ${input.vat.rate}% was requested in the JSON. Check this is correct.`);
  return { ok: true, input, warnings };
}
