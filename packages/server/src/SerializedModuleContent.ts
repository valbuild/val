import {
  type Source,
  type SerializedSchema,
  ValidationErrors,
} from "@valbuild/core";
import type {
  FatalErrorType,
  ModuleFilePath,
  SourcePath,
} from "@valbuild/core";

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
        invalidModulePath?: ModuleFilePath;
        validation?: ValidationErrors;
        fatal?: {
          message: string;
          stack?: string;
          type?: FatalErrorType;
        }[];
      };
    };
