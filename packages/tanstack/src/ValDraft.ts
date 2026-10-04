import type { Json, ModuleFilePath } from "@valbuild/core";

/**
 * What a draft page shows, read by the server for the request that renders it.
 *
 * The source of every module the editor's draft CHANGES -- the ones with
 * patches applied, published-not-yet-built ones included -- and nothing
 * else: a module without changes is the build's own source, which the page
 * already has. Handed to `<ValProvider draft>` so the server's render and the
 * browser's first render resolve the same text, and the page never shows the
 * published version first and the draft a moment later.
 *
 * Plain JSON, because it travels from a server function to the browser in the
 * page's loader data. `fetchValDraft` in `@valbuild/tanstack/server` reads it.
 */
export type ValDraft = {
  sources: Record<ModuleFilePath, Json>;
};
