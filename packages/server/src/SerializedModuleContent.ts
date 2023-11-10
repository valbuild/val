import {
  type Source,
  type SerializedSchema,
  ValidationErrors,
} from "@valbuild/core";
import { ModuleId, type SourcePath } from "@valbuild/core/src/val";

export const FATAL_ERROR_TYPES = [
  "no-schema",
  "no-source",
  "invalid-id",
  "no-module",
] as const;
export type FatalErrorType = (typeof FATAL_ERROR_TYPES)[number];

export type SerializedModuleContent =
  | {
      source: Source;
      schema: SerializedSchema;
      path: SourcePath;
      errors: false;
    }
  | {
      source?: Source;
      schema?: SerializedSchema;
      path: SourcePath;
      errors: {
        invalidModuleId?: ModuleId;
        validation?: ValidationErrors;
        fatal?: {
          message: string;
          stack?: string;
          type?: FatalErrorType;
        }[];
      };
    };
