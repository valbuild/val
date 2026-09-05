import type { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import type { ExternalRecords } from "./externalRecords";

/**
 * The checks that decide whether a project's external records are wired up at
 * all — run once, at startup, rather than discovered when an editor opens a
 * record and gets an empty list.
 *
 * There are two halves to being wired up, and each fails in its own quiet way:
 *
 * - **A module says `.external("posts")` and nothing bound it.** The record
 *   reads as empty. Empty is a legitimate state for a store, so nothing further
 *   down can tell the difference — which is why it has to be caught here.
 * - **Something bound "posts" and no module asks for it.** Usually a rename that
 *   moved one half: the adapter is dead code, and the module it used to serve is
 *   now the case above.
 *
 * Both are reported as module errors, so `/sources/~` fails with "Val is not
 * correctly setup" naming the module, exactly as a nested `.jsonValues()` does.
 */

/** Same shape as `ModulesError` in `ValOps`, without the import cycle. */
export type ExternalSetupError = { path: ModuleFilePath; message: string };

/**
 * External records nested below a module's root, which are not supported.
 *
 * The twin of `findNestedJsonValuesRecords`, and unsupported for a sharper
 * reason: a binding names a MODULE, so there is nowhere for a second adapter
 * inside the same module to be registered. A nested one would read as an empty
 * record forever.
 */
export function findNestedExternalRecords(
  schema: SerializedSchema,
  path: string[] = [],
): string[][] {
  const found: string[][] = [];
  const rec = (current: SerializedSchema, currentPath: string[]) => {
    if (
      current.type === "record" &&
      current.external !== undefined &&
      currentPath.length > 0
    ) {
      found.push(currentPath);
      // Do not descend: everything below lives in the store.
      return;
    }
    switch (current.type) {
      case "object":
        for (const key of Object.keys(current.items)) {
          rec(current.items[key], currentPath.concat(key));
        }
        return;
      case "record":
        rec(current.item, currentPath.concat("*"));
        return;
      case "array":
        rec(current.item, currentPath.concat("*"));
        return;
      case "union":
        for (let i = 0; i < current.items.length; i++) {
          rec(current.items[i], currentPath.concat(`union[${i}]`));
        }
        return;
      default:
        return;
    }
  };
  rec(schema, path);
  return found;
}

/** The label a module's ROOT record declares, if it declares one. */
export function rootExternalLabel(
  schema: SerializedSchema,
): string | undefined {
  return schema.type === "record" ? schema.external : undefined;
}

/**
 * Check a project's schemas against its registry.
 *
 * `records` being undefined means the project registered nothing at all, which
 * is only an error if some module expects an adapter — a project with no
 * external records must not be told to configure something it does not use.
 */
export function checkExternalSetup(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  records: ExternalRecords | undefined,
): ExternalSetupError[] {
  const errors: ExternalSetupError[] = [];
  const boundLabels = new Set<string>();

  for (const moduleFilePathS of Object.keys(schemas)) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (schema === undefined) {
      continue;
    }
    for (const nestedPath of findNestedExternalRecords(schema)) {
      errors.push({
        path: moduleFilePath,
        message: `Nested .external() records are not supported: '${nestedPath.join(
          ".",
        )}' in ${moduleFilePath}. Use .external() only on a module's root record/router.`,
      });
    }
    const label = rootExternalLabel(schema);
    if (label === undefined) {
      continue;
    }
    const binding = records?.bindings[label];
    if (binding === undefined) {
      errors.push({
        path: moduleFilePath,
        message: `${moduleFilePath} is .external("${label}"), but no adapter is registered for '${label}'. Add it to the modules({ ... }) call in your external records file, and pass that file's default export as the 'external' option.`,
      });
      continue;
    }
    boundLabels.add(label);
    if (binding.moduleFilePath !== moduleFilePath) {
      // The label is a type-level check at the `modules({ ... })` call, so this
      // is for the caller TypeScript did not see: a JavaScript project, or one
      // where the two files were never typechecked together.
      errors.push({
        path: moduleFilePath,
        message: `${moduleFilePath} is .external("${label}"), but '${label}' is bound to ${binding.moduleFilePath}.`,
      });
    }
  }

  for (const [label, binding] of Object.entries(records?.bindings ?? {})) {
    if (boundLabels.has(label)) {
      continue;
    }
    // Usually a rename that moved only one half. Reported against the module the
    // binding names, which is where the developer will look.
    errors.push({
      path: binding.moduleFilePath,
      message: `An external adapter is registered as '${label}' for ${binding.moduleFilePath}, but no module declares .external("${label}"). Either add it to the schema, or remove the binding.`,
    });
  }

  return errors;
}
