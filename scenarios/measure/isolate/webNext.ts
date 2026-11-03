/**
 * `@valbuild/next`, as far as valbuild/web's `*.val.ts` files use it, for the
 * isolate probe's `--env web` build (aliased in `wrangler.jsonc`).
 *
 * The real `@valbuild/next` imports React, `next/*` and the Studio's
 * provider, none of which a draft read on Val's server touches. Its `initVal`
 * is core's plus the two routers; this is that and nothing else, so the
 * modules, schemas and config are what the site's own build makes.
 */
import {
  Internal,
  initVal as initCoreVal,
  type ValConfig,
} from "@valbuild/core";

export { modules } from "@valbuild/core";

export function initVal(config?: ValConfig) {
  return {
    ...initCoreVal(config),
    nextAppRouter: Internal.nextAppRouter,
    externalPageRouter: Internal.externalPageRouter,
  };
}
