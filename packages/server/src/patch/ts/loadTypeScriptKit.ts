import type * as publishKit from "./publishKit";

/** What {@link loadTypeScriptKit} loads: see `publishKit.ts`. */
export type TypeScriptKit = typeof publishKit;

/**
 * The TypeScript compiler's half of Val's server, loaded the first time a
 * publish or the history reader asks for it rather than with the server.
 *
 * Node only, by where it is imported from rather than by what it imports:
 * `nodePlatform`, `createValOps` and the two data layers that only run on
 * Node (`ValOpsFS`, `ValOpsHttp`). Nothing the browser entry reaches may
 * import this -- `noNodeFromBrowser.test.ts` follows the `import()` below,
 * as a bundler does.
 */
export function loadTypeScriptKit(): Promise<TypeScriptKit> {
  return import("./publishKit");
}
