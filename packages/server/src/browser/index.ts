/**
 * `@valbuild/server/browser`: Val's server, for a browser tab.
 *
 * Nothing reachable from here may import a Node builtin --
 * `noNodeFromBrowser.test.ts` walks the graph and fails if one appears. The
 * Node-only parts of the server reach it through `ValServerPlatform`, and this
 * entry passes the browser's.
 */
export {
  createInTabVal,
  createInTabValFetch,
  type InTabFetch,
  type InTabValOptions,
} from "./inTabFetch";
export { serverDraftSource } from "../draftReads";
export type { ValRuntime } from "../valRuntime";
export type { ValHead } from "../head";
