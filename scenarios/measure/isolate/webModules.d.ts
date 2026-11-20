/**
 * valbuild/web's `val.modules.ts`, which `wrangler.jsonc` aliases
 * `val-probe-web` to when it builds `worker.web.ts`.
 */
declare module "val-probe-web" {
  import type { ValModules } from "@valbuild/core";
  const valModules: ValModules;
  export default valModules;
}
