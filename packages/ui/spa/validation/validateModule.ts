import { deserializeSchema } from "@valbuild/core";
import type {
  ModuleFilePath,
  Schema,
  SelectorSource,
  SerializedSchema,
  Source,
  SourcePath,
  ValidationErrors,
} from "@valbuild/core";

/**
 * Framework-free validation logic shared by the validation Web Worker and the
 * main-thread fallback in ValidationWorkerClient. Keeps a per-instance cache of
 * deserialized schemas keyed by module path, re-deriving only when the schema
 * sha changes.
 */
export class SchemaValidator {
  private cache = new Map<
    ModuleFilePath,
    { schemaSha: string; schema: Schema<SelectorSource> }
  >();

  validate(
    moduleFilePath: ModuleFilePath,
    source: Source,
    serializedSchema: SerializedSchema,
    schemaSha: string,
  ): ValidationErrors {
    let cached = this.cache.get(moduleFilePath);
    if (!cached || cached.schemaSha !== schemaSha) {
      cached = { schemaSha, schema: deserializeSchema(serializedSchema) };
      this.cache.set(moduleFilePath, cached);
    }
    return cached.schema["executeValidate"](
      moduleFilePath as string as SourcePath,
      source as SelectorSource,
    );
  }
}
