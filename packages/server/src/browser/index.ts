/**
 * `@valbuild/server/browser`: Val's server, for a browser tab.
 *
 * Nothing reachable from here may import a Node builtin --
 * `noNodeFromBrowser.test.ts` walks the graph and fails if one appears. The
 * Node-only parts of the server reach it through `ValServerPlatform`, and this
 * entry passes the browser's.
 */
export { createInTabValFetch, type InTabFetch } from "./inTabFetch";
export {
  SessionStoragePatchStore,
  DEMO_PATCHES_STORAGE_KEY,
  createDemoPatchStore,
  resetDemoPatches,
  type PatchStorage,
} from "./sessionStoragePatchStore";
