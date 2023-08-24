import { SourcePath } from "../../val";
import { ValidationFix } from "./ValidationFix";

export type ValidationError = {
  message: string;
  value?: unknown;
  fixes?: ValidationFix[];
};

/**
 * Equals `false` if no validation errors were found.
 * Errors are indexed by the full source path.
 *
 * Global errors have the path `"/"`.
 */
export type ValidationErrors = false | Record<SourcePath, ValidationError[]>;
