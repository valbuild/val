import {
  type Source,
  type SerializedSchema,
  ValidationErrors,
} from "@valbuild/core";
import type { FatalErrorType, ModuleId, SourcePath } from "@valbuild/core";

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
