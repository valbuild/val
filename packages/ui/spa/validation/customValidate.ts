import {
  Internal,
  ModuleFilePath,
  SerializedObjectSchema,
  SerializedSchema,
  Source,
  SourcePath,
} from "@valbuild/core";
import { sourcePathConcat } from "../components/traverseSchemas";

/**
 * Does this schema tree declare ANY custom validate function?
 *
 * The gate for the whole custom-validation path: serialization records only a
 * `customValidate: true` flag (the function itself cannot survive JSON), and in
 * the common case no module declares one — so this answers false, nothing extra
 * is walked, posted or executed, and behaviour is exactly as before.
 */
export function hasCustomValidate(schema: SerializedSchema): boolean {
  if (schema.customValidate === true) {
    return true;
  }
  switch (schema.type) {
    case "object":
      return Object.values(schema.items).some(hasCustomValidate);
    case "array":
      return hasCustomValidate(schema.item);
    case "record":
      return (
        hasCustomValidate(schema.item) ||
        // The KEY schema can carry validators too (`s.record(s.string().validate(...), …)`).
        (schema.key !== undefined && hasCustomValidate(schema.key))
      );
    case "union":
      return (
        schema.items as (SerializedObjectSchema | SerializedSchema)[]
      ).some(hasCustomValidate);
    default:
      return false;
  }
}

/**
 * Where a module's custom validators need to run, and what has to be loaded
 * first.
 *
 * `paths` are the nodes that (a) declare a validator and (b) actually EXIST in
 * this source — a union branch not taken or an absent optional field must not be
 * reported, or the main thread would try to resolve a path that isn't there.
 *
 * `needsJsonKeys` are `.jsonValues()` entry keys whose content has to be loaded
 * before the answer can be trusted. A validator cannot run against an opaque
 * `{_type:"json"}` marker: if the flagged node is the record itself it needs
 * every entry (a record-level validator is a statement about all of them), and
 * if the flagged node is inside the item schema it needs every entry that is
 * still a marker, since which one violates the rule is exactly what we cannot
 * know without the content.
 */
export type CustomValidateTargets = {
  paths: SourcePath[];
  needsJsonKeys: string[];
};

export function collectCustomValidateTargets(
  moduleFilePath: ModuleFilePath,
  schema: SerializedSchema,
  source: Source,
): CustomValidateTargets {
  const paths: SourcePath[] = [];
  const needsJsonKeys = new Set<string>();

  const go = (
    path: SourcePath,
    schema: SerializedSchema | undefined,
    source: Source,
  ) => {
    if (schema === undefined) {
      return;
    }
    if (Internal.isJson(source)) {
      // An un-loaded entry. Its own key is recorded by the record branch below
      // (which knows the key); there is nothing to walk here.
      return;
    }
    if (source === null) {
      // A nullable node that is null: the validator still applies (a user may
      // reject null), so record the path, but do not descend.
      if (schema.customValidate === true) {
        paths.push(path);
      }
      return;
    }
    if (schema.customValidate === true) {
      paths.push(path);
    }
    switch (schema.type) {
      case "object": {
        if (!isRecordSource(source)) {
          return;
        }
        for (const key in schema.items) {
          if (!(key in source)) {
            continue; // absent optional field: nothing to validate
          }
          go(sourcePathConcat(path, key), schema.items[key], source[key]);
        }
        return;
      }
      case "record": {
        if (!isRecordSource(source)) {
          return;
        }
        // KNOWN GAP: a validator on the record's KEY schema is not run here. A key
        // has no source node of its own — `RecordSchema.executeValidate` validates
        // it against the ENTRY's path, whose schema is the ITEM — so there is no
        // path to emit that `executeCustomValidations` could resolve to the key
        // schema and the key string. `hasCustomValidate` still counts the key
        // schema (a cheap over-approximation of the gate), so such a module is
        // walked; the walk simply finds nothing for the key itself.
        const itemNeedsContent = hasCustomValidate(schema.item);
        for (const key in source) {
          const value = source[key];
          if (Internal.isJson(value)) {
            // Only ask for content that could change the answer: the record's own
            // validator needs all of it, an item validator needs this entry.
            if (schema.customValidate === true || itemNeedsContent) {
              needsJsonKeys.add(key);
            }
            continue;
          }
          go(sourcePathConcat(path, key), schema.item, value);
        }
        return;
      }
      case "array": {
        if (!Array.isArray(source)) {
          return;
        }
        for (let i = 0; i < source.length; i++) {
          go(sourcePathConcat(path, i), schema.item, source[i]);
        }
        return;
      }
      case "union": {
        const schemaKey = schema.key;
        if (typeof schemaKey !== "string" || !isRecordSource(source)) {
          return; // a literal union is a leaf
        }
        const itemKey = source[schemaKey];
        if (typeof itemKey !== "string") {
          return;
        }
        // Only the branch this value actually takes: reporting paths from the
        // others would name fields that do not exist here.
        const branch = (schema.items as SerializedObjectSchema[])
          .filter((item) => item.type === "object")
          .find((item) => {
            const itemKeySchema = item.items[schemaKey];
            return (
              itemKeySchema?.type === "literal" &&
              itemKeySchema.value === itemKey
            );
          });
        if (branch) {
          // The matched variant SHARES the union's path, so `resolvePath` stops at
          // the union and `UnionSchema.executeCustomValidateAt` is what dispatches
          // into the variant. Record the path once — `go(path, branch, ...)` would
          // push it a second time when both declare a validator — then walk the
          // variant's fields.
          if (
            branch.customValidate === true &&
            schema.customValidate !== true
          ) {
            paths.push(path);
          }
          for (const key in branch.items) {
            if (!(key in source)) {
              continue; // absent optional field: nothing to validate
            }
            go(sourcePathConcat(path, key), branch.items[key], source[key]);
          }
        }
        return;
      }
      default:
        return; // leaf: its own flag was handled above
    }
  };

  go(moduleFilePath as unknown as SourcePath, schema, source);
  return { paths, needsJsonKeys: Array.from(needsJsonKeys) };
}

function isRecordSource(source: Source): source is Record<string, Source> {
  return (
    typeof source === "object" && source !== null && !Array.isArray(source)
  );
}
