// @ts-check
/**
 * @typedef {import('eslint').ESLint.Plugin} Plugin
 * @typedef {import('eslint').Linter.LintMessage} LintMessage
 * @typedef {import('eslint').Linter.Processor} Processor
 * @typedef {import('eslint').Linter } RuleModule
 */

import noIllegalModulePaths from "./rules/noIllegalModulePaths";
import noIllegalImports from "./rules/noIllegalImports";
import exportContentMustBeValid from "./rules/exportContentMustBeValid";
import noDefineWithVariable from "./rules/noDefineWithVariable";
import moduleInValModules from "./rules/moduleInValModules";

/**
 * @type {Plugin["rules"]}
 */
export const rules = {
  "no-illegal-module-paths": noIllegalModulePaths,
  "no-illegal-imports": noIllegalImports,
  "export-content-must-be-valid": exportContentMustBeValid,
  "no-define-with-variable": noDefineWithVariable,
  "module-in-val-modules": moduleInValModules,
};

/**
 * @type {Plugin["processors"]}
 */
export const processors = {};

/**
 * @type {Plugin["configs"]}
 */
export const configs = {
  recommended: {
    plugins: ["@valbuild"],
    rules: {
      "@valbuild/no-illegal-module-paths": "error",
      "@valbuild/no-illegal-imports": "error",
      "@valbuild/export-content-must-be-valid": "error",
      "@valbuild/no-define-with-variable": "error",
      "@valbuild/module-in-val-modules": "error",
    },
  },
};

/**
 * @type {Plugin}
 */
export default { rules, processors, configs };
