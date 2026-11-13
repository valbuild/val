import {
  Internal,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";

/**
 * The paths "On this page" lists, with the fields inside a component left out
 * when the component itself is listed.
 *
 * A component rendered with `ValComponentEditor` is tagged on the page as a
 * whole (its item's path), and so is every field it shows. Listing both is
 * listing the title twice: once as a row of its own, and once inside the
 * component's row, which edits the whole object. The component's row is the
 * one kept, because it holds the others.
 *
 * A field is only left out when the component around it is in `paths`: a
 * field whose component is not tagged on the page is all there is to list.
 */
export function collapseIntoComponents(
  paths: readonly SourcePath[],
  schemas: Record<ModuleFilePath, SerializedSchema>,
): readonly SourcePath[] {
  const components = paths.filter((path) =>
    isComponentSchema(schemaAt(path, schemas)),
  );
  if (components.length === 0) {
    return paths;
  }
  const collapsed = paths.filter(
    (path) => !components.some((component) => isAncestorPath(component, path)),
  );
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
 * Could a value with this schema have a component: an object that declares
 * one, or a union with a variant that does. Read off the schema alone, so a
 * section whose variant has none is still counted - harmless, since only its
 * own fields are below it.
 */
function isComponentSchema(schema: SerializedSchema | undefined): boolean {
  if (schema === undefined) {
    return false;
  }
  if (schema.type === "discriminated-union") {
    return schema.items.some((item) => isComponentSchema(item));
  }
  return schema.type === "object" && schema.render?.as === "component";
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
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  let schema: SerializedSchema | undefined = schemas[moduleFilePath];
  const parts = modulePath ? Internal.splitModulePath(modulePath) : [];
  for (const part of parts) {
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
