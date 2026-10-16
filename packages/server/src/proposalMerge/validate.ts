import {
  deserializeSchema,
  type ModuleFilePath,
  type Schema,
  type SelectorSource,
} from "@valbuild/core";
import { schemaErrorsOf, type SchemaError } from "@valbuild/shared/internal";
import type { ProjectModule } from "./project";
import type { Value } from "./threeWay";

export type { SchemaError } from "@valbuild/shared/internal";

/** What a schema reports about this content: see `schemaErrorsOf`. */
export const validateWith = (
  schema: Schema<SelectorSource>,
  moduleFilePath: ModuleFilePath,
  source: Value,
): SchemaError[] => schemaErrorsOf(schema, moduleFilePath, source);

/**
 * A module's errors for this content: its own `validate` where the schema was
 * evaluated, custom rules and all; otherwise what its serialized schema says,
 * which is every rule but a custom `.validate(...)` (a closure does not
 * serialize).
 */
export function validateModule(
  moduleFilePath: ModuleFilePath,
  module: ProjectModule,
  source: Value,
): SchemaError[] {
  if (module.validate) return module.validate(source);
  return validateWith(deserializeSchema(module.schema), moduleFilePath, source);
}

/** The errors of a module's own Source: as evaluated where they were, else found here. */
export function errorsOfSource(
  moduleFilePath: ModuleFilePath,
  module: ProjectModule,
): SchemaError[] {
  return module.errors ?? validateModule(moduleFilePath, module, module.source);
}
