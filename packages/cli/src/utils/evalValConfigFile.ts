/**
 * Moved to `@valbuild/server` so that the CLI and
 * `@valbuild/language-server` resolve project config through the same code.
 * Re-exported here to keep existing CLI imports working.
 */
export { evalValConfigFile, findAndEvalValConfigFile } from "@valbuild/server";
