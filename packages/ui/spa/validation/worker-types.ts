import type {
  ModuleFilePath,
  SerializedSchema,
  Source,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";

export type ValidationWorkerRequest = {
  type: "validate";
  id: string;
  moduleFilePath: ModuleFilePath;
  schemaSha: string;
  serializedSchema: SerializedSchema;
  source: Source;
  /**
   * Also walk (schema, source) and report WHERE this module's custom validate
   * functions have to run. Only set when the module actually declares one, so a
   * project without custom validators pays nothing.
   *
   * The walk belongs here rather than in `executeValidate`: the worker holds a
   * DESERIALIZED schema, which has no user functions at all and therefore cannot
   * report that it skipped any. The worker finds the paths; the main thread, which
   * has the real instances, executes them.
   */
  collectCustomValidate?: boolean;
};

export type ValidationWorkerResponse =
  | {
      type: "result";
      id: string;
      moduleFilePath: ModuleFilePath;
      schemaSha: string;
      errors: ValidationErrors;
      /** Nodes that declare a custom validator AND exist in this source. */
      customValidatePaths?: SourcePath[];
      /**
       * `.jsonValues()` entry keys whose content must be loaded before the custom
       * validators can be trusted (their value is still an opaque marker).
       */
      customValidateNeedsJsonKeys?: string[];
    }
  | {
      type: "error";
      id: string;
      moduleFilePath: ModuleFilePath;
      error: string;
    };
