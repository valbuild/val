import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";

/**
 * The paths "On this page" lists, without the ones a listed row already
 * edits. The outermost wins: its row holds the others.
 *
 * The page tags every element that shows content, so a section is tagged as
 * a whole and so is its title. Listing both is listing the title's editor
 * twice: as a row of its own, and inside the section's row. Nothing here is
 * about components: a component is an object, and an object's row edits its
 * fields like any other's.
 *
 * What a row EDITS is decided by how the Studio draws the value
 * ({@link edits}): an object its fields, and a list rendered inline its
 * items. A list that is not inline draws a PREVIEW row per item, to open -
 * which is not an editor, so a bullet in a section's bullets list keeps its
 * own row, where it can be typed in.
 *
 * Only a row that stays listed counts: a field whose section is not tagged on
 * the page is all there is to list.
 */
export function collapseShownPaths(
  paths: readonly SourcePath[],
  schemas: Record<ModuleFilePath, SerializedSchema>,
): readonly SourcePath[] {
  // Outermost first, and only a row that stays listed hides anything
  const kept = new Set<SourcePath>();
  for (const path of [...paths].sort((a, b) => a.length - b.length)) {
    const shown = Array.from(kept).some((ancestor) => {
      if (!isAncestorPath(ancestor, path)) return false;
      const schema = schemaAt(ancestor, schemas);
      return schema !== undefined && edits(schema, partsBelow(ancestor, path));
    });
    if (!shown) kept.add(path);
  }
  const collapsed = paths.filter((path) => kept.has(path));
  return collapsed.length === paths.length ? paths : collapsed;
}

/**
 * Whether `ancestor` is a path above `path` - not the same path. Compared on
 * the string, at a segment boundary: `"a".0` is above `"a".0."b"` but not
 * above `"a".01`, and `"a"` is not above `"a.b"`.
 */
export function isAncestorPath(
  ancestor: SourcePath,
  path: SourcePath,
): boolean {
  if (path.length <= ancestor.length || !path.startsWith(ancestor)) {
    return false;
  }
  const next = path.slice(ancestor.length);
  return ancestor.includes("?p=")
    ? next.startsWith(".")
    : next.startsWith("?p=");
}

/**
 * Whether the editor of a value with `schema` edits the value `parts` below
 * it in place. An object edits its fields, a union the fields of its variant
 * and an inline list its items; any other list draws a preview row per item,
 * which edits nothing. A hidden field is not drawn at all.
 */
function edits(schema: SerializedSchema, parts: string[]): boolean {
  let current: SerializedSchema | undefined = schema;
  for (const part of parts) {
    if (current === undefined) return false;
    if (
      (current.type === "array" || current.type === "record") &&
      current.render?.as !== "inline"
    ) {
      return false;
    }
    current = childSchema(current, part);
    if (current?.hidden === true) return false;
  }
  return current !== undefined;
}

/** The segments of `path` below `ancestor`, which is above it. */
function partsBelow(ancestor: SourcePath, path: SourcePath): string[] {
  return modulePathParts(path).slice(modulePathParts(ancestor).length);
}

function modulePathParts(path: SourcePath): string[] {
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(path);
  return modulePath ? Internal.splitModulePath(modulePath) : [];
}

/**
 * The schema at a path, walked down from its module without the source. A
 * union's variant is the first that has the next key - a source would say
 * which, but every variant shares the union's path, and a key only some of
 * them have is the one that decides.
 */
function schemaAt(
  path: SourcePath,
  schemas: Record<ModuleFilePath, SerializedSchema>,
): SerializedSchema | undefined {
  const [moduleFilePath] = Internal.splitModuleFilePathAndModulePath(path);
  let schema: SerializedSchema | undefined = schemas[moduleFilePath];
  for (const part of modulePathParts(path)) {
    schema = childSchema(schema, part);
    if (schema === undefined) {
      return undefined;
    }
  }
  return schema;
}

function childSchema(
  schema: SerializedSchema | undefined,
  part: string,
): SerializedSchema | undefined {
  if (schema === undefined) {
    return undefined;
  }
  switch (schema.type) {
    case "object":
      return schema.items[part];
    case "array":
    case "record":
      return schema.item;
    case "discriminated-union":
      for (const variant of schema.items) {
        const child = childSchema(variant, part);
        if (child !== undefined) {
          return child;
        }
      }
      return undefined;
    default:
      return undefined;
  }
}
