// @ts-check
/**
 * `@valbuild/eslint-plugin/rules`: Val's rules over a project that is not on
 * a disk -- the Studio's, which is a proposal's files in memory. Imports no
 * `fs`, `path` or `typescript`, so it runs in a browser; what the rules would
 * have read from the disk comes from the {@link ValProjectHost} given.
 *
 * `@valbuild/eslint-plugin` itself is these rules over the disk.
 *
 * @typedef {import("./projectHost").ValProjectHost} ValProjectHost
 */
import noIllegalModulePaths from "./rules/noIllegalModulePaths";
import noIllegalImports from "./rules/noIllegalImports";
import exportContentMustBeValid from "./rules/exportContentMustBeValid";
import noDefineWithVariable from "./rules/noDefineWithVariable";
import defaultExportValModule from "./rules/defaultExportValModule";
import moduleInValModules from "./rules/moduleInValModules";

export { registeredSpecifiers } from "./projectHost";

/**
 * Every rule, by name, with the project read through `host`.
 *
 * @param {ValProjectHost} host
 * @returns {Record<string, import('eslint').Rule.RuleModule>}
 */
export function createRules(host) {
  return {
    "no-illegal-module-paths": noIllegalModulePaths(host),
    "no-illegal-imports": noIllegalImports,
    "export-content-must-be-valid": exportContentMustBeValid,
    "no-define-with-variable": noDefineWithVariable,
    "default-export-val-module": defaultExportValModule,
    "module-in-val-modules": moduleInValModules(host),
  };
}
