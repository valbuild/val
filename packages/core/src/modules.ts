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
  modules: ValModules["modules"],
): ValModules {
  const result: ValModules = {
    config,
    modules,
  };
  // When evaluated in a browser, register the registry so the Val editor SPA
  // can pick it up without the host app having to thread it through React
  // (which would fail at the Server → Client Component boundary because
  // module `def` entries are function closures). Typed structurally so this
  // file compiles in core's DOM-less tsconfig.
  type BrowserWindow = {
    __VAL_MODULES__?: ValModules;
    dispatchEvent: (event: unknown) => unknown;
    CustomEvent: new (type: string) => unknown;
  };
  const browserWindow = (globalThis as unknown as { window?: BrowserWindow })
    .window;
  if (browserWindow) {
    console.debug("Registering Val modules in the browser", result);
    browserWindow.__VAL_MODULES__ = result;
    browserWindow.dispatchEvent(
      new browserWindow.CustomEvent("val-modules-updated"),
    );
  }
  console.log("Val modules initialized", result);
  return result;
}
