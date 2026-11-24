/**
 * `@valbuild/mcp/metadata`: the OAuth protected-resource document, without the
 * tools.
 *
 * The package root brings Val's whole server with it (the tools run against
 * its data layer), and a framework binding's `initValMcp` is imported by an
 * app's MCP route, which a TanStack Start site's route tree imports on every
 * cold start. The metadata handlers are the one part of `ValMcp` that has to
 * exist synchronously, so they come from here, and the rest is loaded by the
 * first MCP request.
 */
export {
  createValMcpMetadata,
  valMcpMetadataOf,
  VAL_SCOPES_SUPPORTED,
  type ValMcpMetadataHandlers,
} from "../valMcpMetadata";
