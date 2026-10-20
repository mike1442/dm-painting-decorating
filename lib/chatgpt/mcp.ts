import { BackendError } from "../server/supabase.ts";
import { ACTIONS_PATH, ALL_SCOPES, AUTHORIZE_PATH, MCP_PATH, TOKEN_PATH, integrationKeys, originOf, SCOPE_DESCRIPTIONS, type Scope } from "./config.ts";
import { bearerGrant, integrationDisabledResponse, jsonResponse, unauthorised, type Grant } from "./oauth.ts";
import { AuthRequired, ToolError } from "./records.ts";
import { serverInstructions, tools, toolsFor, type Tool, type ToolOutput } from "./tools.ts";

// D&M's MCP server: the protocol ChatGPT uses for apps and connectors, over
// Streamable HTTP. It is stateless (no session ID, no event stream) and answers
// each JSON-RPC request with one JSON response. Every request needs a bearer
// token from D&M's own authorization server; there is no cookie or anonymous
// access, so browsers cannot be used to reach it on Mike's behalf.

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;
const SERVER_INFO = { name: "dm-painting-decorating", title: "D&M Painting & Decorating", version: "1.0.0" };

type JsonRpcId = string | number | null;
type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const rpcResult = (id: JsonRpcId, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: JsonRpcId, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

function annotations(tool: Tool) {
  return {
    title: tool.title,
    readOnlyHint: tool.kind === "read",
    destructiveHint: tool.kind === "delete",
    idempotentHint: tool.kind !== "delete",
    openWorldHint: false,
  };
}
const describe = (tool: Tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: annotations(tool) });

/** Runs one tool for a verified grant. Expected failures become readable tool errors. */
export async function runTool(tool: Tool, args: unknown, grant: Grant): Promise<{ output: ToolOutput; isError: boolean }> {
  if (!grant.scopes.includes(tool.scope)) {
    return { output: { message: `This ChatGPT connection was approved without permission to ${SCOPE_DESCRIPTIONS[tool.scope].toLowerCase()}. Mike can reconnect D&M in ChatGPT and tick that permission.`, data: { status: "not_permitted" } }, isError: true };
  }
  const started = Date.now();
  try {
    const output = await tool.run(args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {}, {
      token: grant.supabase, origin: grant.origin, grant: grant.grant, now: new Date(),
    });
    console.info(`ChatGPT tool ${tool.name} completed in ${Date.now() - started} ms`);
    return { output, isError: false };
  } catch (error) {
    if (error instanceof AuthRequired) throw error;
    console.warn(`ChatGPT tool ${tool.name} ${error instanceof ToolError ? "refused the request" : "failed"} after ${Date.now() - started} ms`);
    if (error instanceof ToolError) return { output: { message: error.message, data: { status: "error", ...error.data } }, isError: true };
    const busy = error instanceof BackendError && error.status === 429;
    return {
      output: {
        message: busy
          ? "D&M's records service is busy. Wait a moment and try again; repeating the same request will not create a duplicate."
          : "D&M's records service did not respond. If this was a change, it may or may not have been saved: check with the matching get_ or list_ tool, or simply repeat the same request (it will not create a duplicate).",
        data: { status: "unavailable" },
      },
      isError: true,
    };
  }
}

async function handleMessage(message: Message, grant: Grant): Promise<object | null> {
  const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  const notification = !("id" in message);
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    // A client's response to a server request: nothing to answer.
    if (message.jsonrpc === "2.0" && ("result" in message || "error" in message)) return null;
    return rpcError(id, -32600, "Invalid JSON-RPC request.");
  }
  if (notification) return null;
  const params = message.params && typeof message.params === "object" ? message.params as Record<string, unknown> : {};
  switch (message.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return rpcResult(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: serverInstructions,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: toolsFor(grant.scopes).map(describe) });
    case "tools/call": {
      const tool = tools.find(candidate => candidate.name === params.name);
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${String(params.name)}`);
      const { output, isError } = await runTool(tool, params.arguments, grant);
      return rpcResult(id, {
        content: [{ type: "text", text: `${output.message}\n\n${JSON.stringify(output.data, null, 2)}` }],
        structuredContent: { message: output.message, ...output.data },
        isError,
      });
    }
    default:
      return rpcError(id, -32601, `Method not found: ${message.method}`);
  }
}

export async function handleMcpPost(request: Request): Promise<Response> {
  // Anonymous clients must be able to discover OAuth before a grant exists,
  // including when the deployment still needs its private signing secret.
  if (!request.headers.has("authorization")) return unauthorised(request, MCP_PATH, false);
  try { integrationKeys(); } catch { return integrationDisabledResponse(); }
  const grant = bearerGrant(request);
  if (!grant) return unauthorised(request, MCP_PATH, request.headers.has("authorization"));
  const version = request.headers.get("mcp-protocol-version");
  if (version !== null && !SUPPORTED_VERSIONS.includes(version)) return jsonResponse(rpcError(null, -32600, `Unsupported MCP-Protocol-Version ${version}.`), 400);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return jsonResponse(rpcError(null, -32600, "Request too large."), 413);
    body = JSON.parse(text);
  } catch { return jsonResponse(rpcError(null, -32700, "Parse error."), 400); }

  try {
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as unknown[];
    if (!messages.length || messages.length > 20) return jsonResponse(rpcError(null, -32600, "Invalid request."), 400);
    const replies: object[] = [];
    for (const message of messages) {
      const reply = message && typeof message === "object" && !Array.isArray(message)
        ? await handleMessage(message as Message, grant)
        : rpcError(null, -32600, "Invalid JSON-RPC request.");
      if (reply) replies.push(reply);
    }
    if (!replies.length) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    return jsonResponse(batch ? replies : replies[0]);
  } catch (error) {
    // Supabase no longer accepts the wrapped session: ChatGPT refreshes or reconnects.
    if (error instanceof AuthRequired) return unauthorised(request, MCP_PATH, true);
    console.warn("ChatGPT MCP request failed unexpectedly");
    return jsonResponse(rpcError(null, -32603, "Internal error."), 500);
  }
}

/** Discovery probes need the same OAuth challenge as an anonymous POST. */
export function handleMcpGet(request: Request): Response {
  if (!request.headers.has("authorization")) return unauthorised(request, MCP_PATH, false);
  try { integrationKeys(); } catch { return integrationDisabledResponse(); }
  if (!bearerGrant(request)) return unauthorised(request, MCP_PATH, request.headers.has("authorization"));
  return handleMcpOther();
}

/** No server-initiated stream is offered; sessions are not used. */
export function handleMcpOther(): Response {
  return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

/* Custom GPT actions ------------------------------------------------------- */

/** The answer to every action: what to tell Mike, and the saved quote or invoice as read back from D&M's records. */
const actionResult = {
  type: "object",
  properties: {
    message: { type: "string", description: "What happened, in words to relay to Mike." },
    status: { type: "string", description: "The outcome, e.g. created, already_created, updated, recorded, booked, confirmation_required, possible_duplicate, clash, unverified or error." },
    document: {
      type: "object",
      description: "The quote or invoice created or changed, read back from D&M's records. Give Mike its number, amount and customerLink exactly as here.",
      properties: {
        kind: { type: "string", description: "quote or invoice" },
        id: { type: "string" },
        number: { type: "string", description: "The number D&M issued, e.g. Q-0041 or INV-0012." },
        customer: { type: "string" },
        amount: { type: "string", description: "Total including any VAT, e.g. £850.00." },
        status: { type: "string" },
        customerLink: { type: "string", description: "A new customer link, checked to open this document; null when no new link was made." },
        customerLinkStatus: { type: "string", description: "new, unchanged (any earlier link keeps working), not-requested, failed or revoked." },
        verified: { type: "boolean", description: "True only when the saved record was read back and matches the request." },
      },
      additionalProperties: true,
    },
    confirmationCode: { type: "string", description: "Only after Mike explicitly says yes, send it back to the same action." },
  },
  additionalProperties: true,
};

/** JSON Schema as the GPT builder accepts it: no empty required lists. */
function forActions(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(forActions);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema)
    .filter(([key, value]) => !(key === "required" && Array.isArray(value) && !value.length))
    .map(([key, value]) => [key, forActions(value)]));
}
const takesInput = (tool: Tool) => Object.keys((tool.inputSchema as { properties?: object }).properties ?? {}).length > 0;

/** OpenAPI description of the same tools, for a Custom GPT's Actions (the route that works in ChatGPT's iPhone app). */
export function openApiDocument(request: Request): Response {
  try { integrationKeys(); } catch { return integrationDisabledResponse(); }
  const origin = originOf(request);
  const scopes = Object.fromEntries(ALL_SCOPES.map(scope => [scope, SCOPE_DESCRIPTIONS[scope]]));
  const paths = Object.fromEntries(tools.map(tool => [`${ACTIONS_PATH}/actions/${tool.name}`, {
    post: {
      operationId: tool.name,
      summary: tool.title,
      description: tool.summary,
      "x-openai-isConsequential": tool.kind !== "read",
      security: [{ dmOAuth: [tool.scope] }],
      // An action without inputs is sent without a body.
      ...(takesInput(tool) ? { requestBody: { required: true, content: { "application/json": { schema: forActions(tool.inputSchema) } } } } : {}),
      responses: {
        "200": { description: "The result, with a message to relay to Mike.", content: { "application/json": { schema: { $ref: "#/components/schemas/ActionResult" } } } },
        "401": { description: "Sign in to D&M again." },
      },
    },
  }]));
  return jsonResponse({
    openapi: "3.1.0",
    info: {
      title: "D&M Painting & Decorating admin",
      version: "1.1.0",
      description: "Mike's private D&M admin: create and update real quotes and invoices, record payments, return checked customer links and keep the diary. Never invent prices, numbers or links.",
    },
    servers: [{ url: origin }],
    paths,
    components: {
      schemas: { ActionResult: actionResult },
      securitySchemes: {
        dmOAuth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: `${origin}${AUTHORIZE_PATH}`, tokenUrl: `${origin}${TOKEN_PATH}`, scopes } } },
      },
    },
  });
}

export async function handleAction(request: Request, name: string): Promise<Response> {
  try { integrationKeys(); } catch { return integrationDisabledResponse(); }
  const tool = tools.find(candidate => candidate.name === name);
  if (!tool) return jsonResponse({ message: "Unknown action." }, 404);
  const grant = bearerGrant(request);
  if (!grant) return unauthorised(request, ACTIONS_PATH, request.headers.has("authorization"));
  let args: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return jsonResponse({ message: "Request too large." }, 413);
    args = text ? JSON.parse(text) : {};
  } catch { return jsonResponse({ message: "Send the action input as JSON." }, 400); }
  try {
    const { output, isError } = await runTool(tool, args, grant);
    return jsonResponse({ message: output.message, ...output.data, ...(isError ? { error: true } : {}) });
  } catch (error) {
    if (error instanceof AuthRequired) return unauthorised(request, ACTIONS_PATH, true);
    console.warn("ChatGPT action failed unexpectedly");
    return jsonResponse({ message: "Internal error." }, 500);
  }
}

export const toolNames = (scopes: Scope[] = ALL_SCOPES) => toolsFor(scopes).map(tool => tool.name);

