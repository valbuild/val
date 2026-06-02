import type {
  ModuleFilePath,
  SerializedSchema,
  Source,
  ValidationErrors,
} from "@valbuild/core";

export type ValidationWorkerRequest = {
  type: "validate";
  id: string;
  moduleFilePath: ModuleFilePath;
  schemaSha: string;
  serializedSchema: SerializedSchema;
  source: Source;
};

export type ValidationWorkerResponse =
  | {
      type: "result";
      id: string;
      moduleFilePath: ModuleFilePath;
      schemaSha: string;
      errors: ValidationErrors;
    }
  | {
      type: "error";
      id: string;
      moduleFilePath: ModuleFilePath;
      error: string;
    };
