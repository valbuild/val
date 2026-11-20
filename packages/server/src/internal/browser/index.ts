/**
 * `@valbuild/server/internal/browser`: the in-tab server's internals, for the
 * isolate probe (`scenarios/measure/isolate/`). Not public API.
 *
 * Bundleable for a browser, like `@valbuild/server/browser`:
 * `noNodeFromBrowser.test.ts` walks this entry too.
 */
export { createInTabVal, type InTabValOptions } from "../../browser/inTabFetch";
export { serverDraftSource } from "../../draftReads";
export type { ValRuntime } from "../../valRuntime";
export type { ValHead } from "../../head";
