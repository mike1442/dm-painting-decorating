import { ADMIN_EMAIL } from "../admin/auth.ts";
import { SCOPE_DESCRIPTIONS, type Scope } from "./config.ts";

// The page Mike sees once, when ChatGPT asks to connect. It is plain server HTML
// with no scripts, so it works in any browser ChatGPT opens, and its strict
// policy forbids framing and allows the form to continue only to ChatGPT.

const escape = (value: string) => value.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f1ea;--card:#fff;--ink:#0c141a;--muted:#55606a;--line:#d9d4c9;--accent:#0c141a;--warn:#9a2c12}
@media (prefers-color-scheme:dark){:root{--bg:#0c141a;--card:#16212a;--ink:#f3efe6;--muted:#a9b3bb;--line:#2b3943;--accent:#e8dcc0;--warn:#ff9c7a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:30rem;margin:0 auto;padding:32px 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px}
h1{font-size:1.4rem;line-height:1.25;margin:0 0 8px}p{margin:0 0 12px}.muted{color:var(--muted);font-size:.92rem}
ul{padding-left:1.2rem;margin:0 0 16px}li{margin:4px 0}
label{display:block;font-weight:600;margin:14px 0 6px}
input[type=email],input[type=password]{width:100%;font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:0 0 16px}.check input{margin-top:5px;width:18px;height:18px}
.alert{color:var(--warn);font-weight:600}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}
button{font:inherit;font-weight:600;border-radius:10px;padding:12px 18px;cursor:pointer;border:1px solid var(--accent)}
.primary{background:var(--accent);color:var(--card)}.secondary{background:transparent;color:var(--ink)}
`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${escape(title)} | D&amp;M admin</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

export function consentPage({ clientName, scopes, request, error }: { clientName: string; scopes: Scope[]; request: string; error?: string }) {
  const listed = scopes.filter(scope => scope !== "dm:delete").map(scope => `<li>${escape(SCOPE_DESCRIPTIONS[scope])}</li>`).join("");
  const deletion = scopes.includes("dm:delete")
    ? `<label class="check"><input type="checkbox" name="allow_delete" value="on" checked><span>Also allow deleting records and revoking customer links. ChatGPT will still ask you before each one.</span></label>`
    : "";
  return page("Connect ChatGPT", `<div class="card">
<h1>Connect ChatGPT to D&amp;M admin</h1>
<p><strong>${escape(clientName)}</strong> is asking to work with your D&amp;M records as your assistant. It will be able to:</p>
<ul>${listed}</ul>
<form method="post" autocomplete="on">
<input type="hidden" name="request" value="${escape(request)}">
${deletion}
<p class="muted">Only continue if you started connecting D&amp;M in your own ChatGPT account just now. D&amp;M checks your password itself; it is never given to ChatGPT. You can disconnect at any time.</p>
${error ? `<p class="alert" role="alert">${escape(error)}</p>` : ""}
<label for="email">Email</label>
<input id="email" type="email" name="email" value="${escape(ADMIN_EMAIL)}" autocomplete="username" readonly>
<label for="password">D&amp;M admin password</label>
<input id="password" type="password" name="password" autocomplete="current-password" required minlength="8" maxlength="200">
<div class="actions">
<button class="primary" type="submit" name="decision" value="allow">Allow</button>
<button class="secondary" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
</div>
</form>
</div>`);
}

export function problemPage(title: string, message: string) {
  return page(title, `<div class="card"><h1>${escape(title)}</h1><p role="alert">${escape(message)}</p><p class="muted">Start connecting again from ChatGPT. If this keeps happening, open D&amp;M admin → Settings → ChatGPT.</p></div>`);
}
