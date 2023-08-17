import { Json } from "../../Json";
import { SourcePath } from "../../val";

/**
 * Equals `false` if no validation errors were found.
 * Errors are indexed by the full source path.
 *
 * Global errors have the path `"/"`.
 */
export type ValidationError =
  | false
  | Record<SourcePath | "/", { message: string; value?: unknown }[]>;
