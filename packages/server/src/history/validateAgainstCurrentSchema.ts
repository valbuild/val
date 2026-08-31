import { result } from "@valbuild/core/fp";
import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type Source,
  type SourcePath,
} from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import type { ValOps, Schemas, Sources } from "../ValOps";
import type { HistoryError } from "./HistoryError";

export type SchemaVerdict = {
  /** Per module, in the order they were checked. Empty means it all fits. */
  problems: Record<ModuleFilePath, HistoryError[]>;
};

/**
 * Can this historical value be written back into the project as it is TODAY?
 *
 * This is the restore gate, and the reason it is a question at all: history
 * hands back a value that was valid against the schema of its time, and the
 * schema has since moved. A field may have changed type, gained a constraint,
 * or been removed outright. Writing the old value back would put the module in
 * a state the current schema calls invalid - so the check is against the
 * current schema, never against a stored copy of the old one.
 *
 * Two distinct refusals, because validation alone does not catch both:
 *
 *   schema-mismatch - the value is there and the schema rejects it.
 *   unknown-field   - the value has a key the schema does not define. A schema
 *                     will not always object to an extra key, and restoring one
 *                     silently reintroduces a field somebody deliberately
 *                     removed.
 *
 * A module with no schema at all is `module-removed`: there is nowhere to put
 * the value back.
 */
export async function validateAgainstCurrentSchema(
  ops: ValOps,
  historicalSources: Record<ModuleFilePath, JSONValue>,
): Promise<result.Result<SchemaVerdict, HistoryError>> {
  let schemas: Schemas;
  try {
    schemas = await ops.getSchemas();
  } catch (err) {
    return result.err({
      kind: "transport",
      message: `Could not read the project's schemas: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }

  const problems: Record<ModuleFilePath, HistoryError[]> = {};
  const present: Schemas = {};
  const sources: Sources = {};

  for (const [pathString, source] of Object.entries(historicalSources)) {
    const moduleFilePath = pathString as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (schema === undefined) {
      problems[moduleFilePath] = [{ kind: "module-removed", moduleFilePath }];
      continue;
    }
    present[moduleFilePath] = schema;
    // A historical source is JSON; a Source is that same JSON plus the shapes
    // the schema gives it meaning. validateSources reads it through the schema,
    // which is exactly the check being asked for.
    sources[moduleFilePath] = source as Source;
  }

  if (Object.keys(present).length > 0) {
    const validation = await ops.validateSources(present, sources);
    for (const [pathString, moduleErrors] of Object.entries(
      validation.errors,
    )) {
      const moduleFilePath = pathString as ModuleFilePath;
      const collected: HistoryError[] = problems[moduleFilePath] ?? [];
      if (moduleErrors.invalidSource) {
        collected.push({
          kind: "schema-mismatch",
          moduleFilePath,
          sourcePath: moduleFilePath as unknown as SourcePath,
          errors: [{ message: moduleErrors.invalidSource.message }],
        });
      }
      for (const [sourcePathString, errors] of Object.entries(
        moduleErrors.validations,
      )) {
        if (errors.length === 0) continue;
        collected.push({
          kind: "schema-mismatch",
          moduleFilePath,
          sourcePath: sourcePathString as SourcePath,
          errors,
        });
      }
      if (collected.length > 0) {
        problems[moduleFilePath] = collected;
      }
    }

    // Extra keys, which validation does not necessarily object to.
    for (const [pathString, schema] of Object.entries(present)) {
      const moduleFilePath = pathString as ModuleFilePath;
      const source = historicalSources[moduleFilePath];
      if (source === undefined) continue;
      let serialized: SerializedSchema;
      try {
        serialized = schema["executeSerialize"]();
      } catch {
        // An unserializable schema is reported elsewhere; there is nothing to
        // compare keys against, so skip rather than invent a failure.
        continue;
      }
      const unknown: HistoryError[] = [];
      collectUnknownFields(
        moduleFilePath,
        moduleFilePath as unknown as SourcePath,
        serialized,
        source,
        unknown,
      );
      if (unknown.length > 0) {
        problems[moduleFilePath] = (problems[moduleFilePath] ?? []).concat(
          unknown,
        );
      }
    }
  }

  return result.ok({ problems });
}

function pathOf(parent: SourcePath, key: string | number): SourcePath {
  return Internal.createValPathOfItem(parent, key) ?? parent;
}

/**
 * Keys in the historical value that the current schema does not define.
 *
 * Walks only where the schema says there is structure to walk. An `object`
 * names its fields, so an extra one is detectable; a `record` is keyed by the
 * author, so extra keys are the normal case and mean nothing.
 */
function collectUnknownFields(
  moduleFilePath: ModuleFilePath,
  path: SourcePath,
  schema: SerializedSchema,
  value: JSONValue,
  out: HistoryError[],
): void {
  if (value === null || typeof value !== "object") {
    return;
  }
  if (schema.type === "object") {
    if (Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.items[key];
      if (childSchema === undefined) {
        out.push({
          kind: "unknown-field",
          moduleFilePath,
          sourcePath: pathOf(path, key),
          key,
        });
        continue;
      }
      collectUnknownFields(
        moduleFilePath,
        pathOf(path, key),
        childSchema,
        child,
        out,
      );
    }
    return;
  }
  if (schema.type === "array" && Array.isArray(value)) {
    value.forEach((item, index) => {
      collectUnknownFields(
        moduleFilePath,
        pathOf(path, index),
        schema.item,
        item,
        out,
      );
    });
    return;
  }
  if (schema.type === "record" && !Array.isArray(value)) {
    // Record KEYS are author-chosen, so an unfamiliar one is not an unknown
    // field. Its values still have a schema, so keep walking.
    for (const [key, child] of Object.entries(value)) {
      collectUnknownFields(
        moduleFilePath,
        pathOf(path, key),
        schema.item,
        child,
        out,
      );
    }
    return;
  }
  if (schema.type === "union") {
    // Which branch a value belongs to is decided by the discriminator, and
    // getting that wrong would report every non-matching branch's fields as
    // unknown. validateSources already resolves the union properly, so leave
    // unions to it.
    return;
  }
}
