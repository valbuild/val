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
export const processors = {
  val: {
    /**
     * @param {string} text
     * @param {string} filename
     *  @returns {{ filename: string, text: string }[]}
     */
    preprocess: (text, filename) => {
      console.log("preprocess", { text, filename });
      return [{ text, filename }];
    },
    /**
     * Transforms generated messages for output.
     * @param {LintMessage[][]} messages An array containing one array of messages
     *     for each code block returned from `preprocess`.
     * @param {string} filename The filename of the file
     * @returns {LintMessage[]} A flattened array of messages with mapped locations.
     */
    postprocess: (messages, filename) => {
      console.log({ messages, filename });
      return messages.flat();
    },
  },
};

/**
 * @type {Plugin}
 */
export default { rules, processors };
