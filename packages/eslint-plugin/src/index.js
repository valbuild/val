// @ts-check
/**
 * @typedef {import('eslint').ESLint.Plugin} Plugin
 * @typedef {import('eslint').Linter.LintMessage} LintMessage
 * @typedef {import('eslint').Linter.Processor} Processor
 * @typedef {import('eslint').Linter } RuleModule
 * @typedef {import('@valbuild/server').Service } Service
 */

import deasync from "deasync";
import sp from "synchronized-promise";
import noIllegalModuleIds from "./rules/noIllegalModuleIds";
import { createService } from "@valbuild/server";

/**
 * @type {Plugin["rules"]}
 */
export const rules = {
  "no-illegal-module-ids": noIllegalModuleIds,
  validate: {
    meta: {
      type: "problem",
      docs: {
        description: "Validates Val files",
        category: "Best Practices",
        recommended: true,
      },
      fixable: "code",
      schema: [],
    },
    create() {
      return {};
    },
  },
};

// Does not work:
// const createServiceSync = deasync(
//   (
//     /** @type {string} */ projectRoot,
//     /** @type {Record<String, string>} */ opts,
//     /** @type {(err: Error | undefined, result: Service | Error) => void} */ callback
//   ) =>
//     createService(projectRoot, opts)
//       .then((service) => (console.log("here"), callback(undefined, service)))
//       .catch((err) => (console.log("there"), callback(err, err)))
// );

// Unsurprisingly this does not work either (based on deasync):
// const createServiceSync = sp(createService);

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
      const service = createServiceSync(process.cwd(), {});
      if (service instanceof Error) {
        throw service;
      }
      console.log(service);
      // service.get("/app/test", "");
      // service.set(filename, createServiceSync(process.cwd(), {}));
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
