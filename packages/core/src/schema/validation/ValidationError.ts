import { SourcePath } from "../../val";

/**
 * Validation error: false if no validation errors were found, or a map of source path to error messages.
 */
export type ValidationError = false | Record<SourcePath, string[]>;
