// @ts-check
/**
 * @typedef {import('eslint').ESLint.Plugin} Plugin
 * @typedef {import('eslint').Linter.LintMessage} LintMessage
 * @typedef {import('eslint').Linter.Processor} Processor
 * @typedef {import('eslint').Linter } RuleModule
 */

import noIllegalModuleIds from "./rules/noIllegalModuleIds";

/**
 * @type {Plugin["rules"]}
 */
export let rules = {
  "no-illegal-module-ids": noIllegalModuleIds,
};

/**
 * @type {Plugin["processors"]}
 */
export const processors = {};

/**
 * @type {Plugin}
 */
export default { rules, processors };
