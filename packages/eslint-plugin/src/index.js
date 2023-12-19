// @ts-check
/**
 * @typedef {import('eslint').ESLint.Plugin} Plugin
 * @typedef {import('eslint').Linter.LintMessage} LintMessage
 * @typedef {import('eslint').Linter.Processor} Processor
 * @typedef {import('eslint').Linter } RuleModule
 */

import noIllegalModuleIds from "./rules/noIllegalModuleIds";
import noIllegalImports from "./rules/noIllegalImports";
import exportContentMustBeValid from "./rules/exportContentMustBeValid";

/**
 * @type {Plugin["rules"]}
 */
export let rules = {
  "no-illegal-module-ids": noIllegalModuleIds,
  "no-illegal-imports": noIllegalImports,
  "export-content-must-be-valid": exportContentMustBeValid,
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
      "@valbuild/no-illegal-module-ids": "error",
      "@valbuild/no-illegal-imports": "error",
      "@valbuild/export-content-must-be-valid": "error",
    },
  },
};

/**
 * @type {Plugin}
 */
export default { rules, processors, configs };
