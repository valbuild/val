import { ValConfig } from "./initVal";
import { ValModule } from "./module";
import { SelectorSource } from "./selector";

export type ValModules = {
  config: ValConfig;
  modules: {
    /**
     * A module definition defined as a function that returns a promise that resolves to the module.
     *
     * @example
     * { def: () => import('./module.val') }
     */
    def: () => Promise<{
      default: ValModule<SelectorSource>;
    }>;
  }[];
};

/**
 * Define the set of modules that can be edited using the Val UI.
 *
 * @example
 * import { modules } from "@valbuild/next";
 * import { config } from "./val.config";
 *
 * export default modules(config, [
 *  { def: () => import("./app/page.val.ts") },
 *  { def: () => import("./app/another/page.val.ts") },
 * ]);
 */
export function modules(
  config: ValConfig,
  modules: ValModules["modules"]
): ValModules {
  return {
    config,
    modules,
  };
}
