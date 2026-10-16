import {
  deserializeSchema,
  Internal,
  type ModuleFilePath,
  type Schema,
  type SelectorSource,
  type SourcePath,
} from "@valbuild/core";
import type { ProjectModule } from "./project";
import type { Value } from "./threeWay";

/** Content a schema does not allow, by path in the module. */
export type SchemaError = { path: string[]; message: string };

/** What a schema reports about this content, without the fixes the server makes on its own. */
export function validateWith(
  schema: Schema<SelectorSource>,
  moduleFilePath: ModuleFilePath,
  source: Value,
): SchemaError[] {
  const res = schema["executeValidate"](
    moduleFilePath as string as SourcePath,
    source,
  );
  if (res === false) return [];
  const errors: SchemaError[] = [];
  for (const [sourcePath, list] of Object.entries(res)) {
    const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
      sourcePath as SourcePath,
    );
    const path = modulePath ? Internal.createPatchPath(modulePath) : [];
    for (const error of list) {
      if (error.fixes && error.fixes.length > 0) continue;
      errors.push({ path, message: error.message });
    }
  }
  return errors;
}

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
