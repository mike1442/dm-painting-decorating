# Quotations from Mike's ChatGPT: Quick quote

Mike asks ChatGPT on his phone to quote a customer. ChatGPT cannot save anything: it replies with a link that fills in **Admin → Quick quote**. Mike taps it, checks and corrects the details, and saves a **draft**. Nothing is sent to the customer and no customer link is made until Mike creates one himself in the quote editor.

This works in the ordinary ChatGPT app on any phone. It needs no Supabase connection, Custom GPT or database change.

## Set up once

1. Open D&M admin → **Settings** → *Quick quote from ChatGPT* (or Quotes → New quote → Quick quote → *Set up ChatGPT to send Quick quote links*) and press **Copy**.
2. In the ChatGPT app, open Settings → Personalisation → **Custom instructions** and paste the text into “Anything else ChatGPT should know”. Save. The text is under ChatGPT's 1,500-character limit. If the invoice instructions from [chatgpt-invoices.md](chatgpt-invoices.md) are already there, keep both, or put one of them in a ChatGPT Project called “D&M”.

The instructions point at the address Mike copied them from, so copy them from the live site, not a preview.

## Using it

1. Say to ChatGPT, for example: **“Quote John Smith, 12 Mill Lane, Lymm, WA13 9SD: £1,250 for the lounge and hallway, prepare and fill, two coats.”**
2. ChatGPT replies with one line and a link like `https://www.dmpaintingdecorating.co.uk/admin/quick-quote?for=John%20Smith&title=Lounge%20and%20hallway&total=1250&add=Prepare%20and%20fill%7CTwo%20coats&address=12%20Mill%20Lane%2C%20Lymm%2C%20WA13%209SD`.
3. Tap the link. If the admin asks you to sign in, sign in and you come straight back to the same quote.
4. Check the customer, job title, the points of work and the price before VAT. If the customer has been quoted, invoiced or booked before, Quick quote offers their saved details: tap to use them.
5. Press **Save draft quotation**. The quote editor opens only once the draft has reached D&M's cloud records. It has the next quote number, the standard introduction, terms and validity from Settings, and VAT as set in Settings.
6. Edit anything else in the editor: VAT, materials, itemised prices, deposit. When you are ready, create the customer link there, as for any quote.

Quick quote also works without ChatGPT: Quotes → New quote → **Quick quote**.

## What the link can carry

| Field | Meaning |
| --- | --- |
| `for` | Customer's name |
| `title` | Short job title; otherwise the first point of work |
| `total` | Price in pounds before VAT, e.g. `1250` or `1250.50`. `£1,250` is also understood. Anything else is shown for Mike to correct, never guessed |
| `add` | Points of work, separated by `\|` (or repeated `add=`) |
| `address`, `phone`, `email` | Only when Mike gives them. `address` is one line, e.g. `12 Mill Lane, Lymm, WA13 9SD` |
| `test=1` | A TEST quotation: a `TEST-` number, marked as a test document, never issued |

The price becomes one line of works at that total. The points of work become the scope of works.

## Safety

- The link only fills in the form. Opening it saves nothing, and anyone without Mike's sign-in is sent to the login page.
- The draft is saved by the admin's own cloud store, with the same numbering, revision check and Supabase functions as every other quote.
- Opening the same link again shows the saved draft instead of making a second quote with another number.
- If the save fails (no signal, an expired session, another device saving at the same moment), Quick quote says so plainly, keeps the draft on screen and offers **Try saving again**. The editor never opens for a draft that has not been saved.
- After sign-in the login page only returns to a page of this admin on this site.
- The link's details (customer name, address, price) travel in the web address, so they also appear in the phone's browser history and the website's request logs, as any admin address does. ChatGPT already has them from the conversation.

## Checks

- `tests/admin/quick-quote.test.ts`: link reading, price checks (including the £500 that the first version saved as £50,000), numbering, VAT from Settings, TEST quotations, the repeat-link ID, customer matching and that the example link in ChatGPT's instructions reads back exactly.
- `tests/admin/return-path.test.ts` and `tests/admin/middleware.test.ts`: the sign-in return path, which accepts only pages of this admin.
- `tests/live/quick-quote.spec.ts`, run on desktop and mobile by the isolated admin workflow against the real migrations: the sign-in return, checking and correcting the details, the saved draft read back from storage and on a second device, no customer link created, the repeat link, an earlier customer's details, an unreadable price and a failed save that is retried.
