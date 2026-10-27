import { createMcpHandler } from "mcp-handler";
import { valMcpAuthorize, valMcpTools } from "../../../val/mcp";

/**
 * Val's content tools over MCP.
 *
 * This is the whole of what an app has to write. The tools, and the two checks
 * that decide whether a request may reach them, come from `@valbuild/next` —
 * deliberately, because they are security-relevant and should not be
 * re-implemented per app. What is left here is transport: which SDK, which
 * route, and how a `ValToolResult` becomes a `CallToolResult`.
 *
 * Point an MCP client at `http://localhost:3456/api/mcp`. In local dev that is
 * all it needs; against a deployed app in proxy mode it also needs the user's
 * own personal access token as a bearer token, which `val login` writes.
 */

const handler = createMcpHandler(
  async (server) => {
    // Listing needs no credential, so the tools are registered once at startup
    // rather than per request. Only calling them is per-caller.
    const tools = await valMcpTools();
    for (const tool of tools.list()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args, ctx) => {
          // Authorized per call, from that call's own HTTP request: the
          // credential belongs to the caller, not to the server instance the
          // tools were registered on.
          const authorized = await valMcpAuthorize(ctx.http?.req);
          if (authorized.status === "refused") {
            return toolError(await refusalMessage(authorized.response));
          }
          const result = await authorized.tools.call(
            tool.name,
            args,
            authorized.ctx,
          );
          if (result.status === "error") {
            // In-band, so the model sees a failed tool call it can recover from
            // rather than a dead transport. The code goes in the text because
            // it is what distinguishes "try something else" from "try again".
            return toolError(`${result.code}: ${result.message}`);
          }
          return {
            content: [
              { type: "text" as const, text: JSON.stringify(result.data) },
            ],
          };
        },
      );
    }
  },
  {
    serverInfo: { name: "val", version: "1" },
  },
);

/**
 * Refuse before the protocol layer, then serve.
 *
 * The per-call check inside each tool is not enough on its own: a request that
 * should not be answered at all — a browser on another origin, or fs mode on a
 * deployed host — must not get as far as an `initialize` handshake.
 */
async function route(request: Request): Promise<Response> {
  const authorized = await valMcpAuthorize(request);
  if (authorized.status === "refused") {
    return authorized.response;
  }
  return handler(request);
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** The refusal's own message, so the reason survives into the tool result. */
async function refusalMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    // fall through to the generic message
  }
  return `Val refused this MCP call (HTTP ${response.status}).`;
}

export { route as GET, route as POST, route as DELETE };
