import "server-only";
export { initValServer } from "./initValServer";
export { initValMcp } from "./initValMcp";
export type { ValMcp, ValMcpAuthorizationResult } from "./initValMcp";

/**
 * The external-record adapter contract, re-exported so an app has one place to
 * import its server-side Val API from.
 *
 * It lives in `@valbuild/server`, which a Next app does not otherwise depend on:
 * `@valbuild/next` is the package an app installs, and `defineExternal` belongs
 * next to `initValServer` because the two are used in the same file — the
 * `server-only` one where the driver lives.
 */
export {
  defineExternal,
  ok,
  err,
  isExternalResult,
  EXTERNAL_RESULT,
} from "@valbuild/server";
export type {
  AdapterFor,
  ExternalAuthor,
  ExternalCtx,
  ExternalDefinition,
  ExternalFile,
  ExternalIssue,
  ExternalKeyPage,
  ExternalRecords,
  ExternalResult,
  ExternalSearchHit,
  ExternalSearchPage,
  ExternalSort,
  ItemOfModule,
  Returns,
} from "@valbuild/server";
