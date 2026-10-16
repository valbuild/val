import { Internal, type ModuleFilePath } from "@valbuild/core";
import type { JSONValue } from "@valbuild/core/patch";
import { schemaErrorsOf, type Evaluated } from "@valbuild/shared/internal";

/**
 * What a tree's `val.modules.ts` says, once bundled and imported
 * (`bundleValModules`): each module's schema, the content its text holds, and
 * the errors of `sourceOf`'s content under that schema -- found here, on the
 * schema instance the tree's own code made, so a custom `.validate(...)` takes
 * part. Update from the site with code (valbuild/home
 * `docs/hosted-publishing.md` step 8.2, slice 1b).
 *
 * The modules were made by the site's copy of `@valbuild/core`, read here with
 * the Studio's: the symbols a module carries are `Symbol.for`, shared by both
 * (`isValModule`).
 */
export async function readValModules(
  entry: unknown,
  sourceOf: (moduleFilePath: ModuleFilePath) => JSONValue | null,
): Promise<Evaluated> {
  const evaluated: Evaluated = {};
  for (const def of defsOf(entry)) {
    const loaded = await def();
    const module =
      typeof loaded === "object" && loaded !== null && "default" in loaded
        ? loaded.default
        : undefined;
    if (!Internal.isValModule(module)) {
      throw new Error(
        "A module val.modules.ts names does not export c.define(...) as its default.",
      );
    }
    const moduleFilePath = Internal.getValPath(module);
    const schema = Internal.getSchema(module);
    if (moduleFilePath === undefined || schema === undefined) continue;
    const path = moduleFilePath as string as ModuleFilePath;
    const written = toJson(
      await Internal.resolveJsonValues(Internal.getSource(module)),
      path,
    );
    evaluated[path] = {
      schema: schema["executeSerialize"](),
      written,
      errors: schemaErrorsOf(schema, path, sourceOf(path) ?? written),
    };
  }
  return evaluated;
}

/** The `def`s of `modules(config, [...])`, the bundle's default export. */
function defsOf(entry: unknown): (() => Promise<unknown>)[] {
  const valModules =
    typeof entry === "object" && entry !== null && "default" in entry
      ? entry.default
      : undefined;
  if (
    typeof valModules !== "object" ||
    valModules === null ||
    !("modules" in valModules) ||
    !Array.isArray(valModules.modules)
  ) {
    throw new Error(
      "val.modules.ts does not export modules(config, [...]) as its default.",
    );
  }
  return valModules.modules.map((item: unknown) => {
    const def =
      typeof item === "object" && item !== null && "def" in item
        ? item.def
        : undefined;
    if (typeof def !== "function") {
      throw new Error("An entry of val.modules.ts has no def to import.");
    }
    return async (): Promise<unknown> => def();
  });
}

/**
 * A module's Source as JSON, which it is once its `.val.json` entries are
 * read (media are plain objects): what can cross to a worker's caller and a
 * server. Anything else is named rather than dropped.
 */
function toJson(value: unknown, at: string): JSONValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJson(item, `${at}/${index}`));
  }
  if (typeof value === "object") {
    const json: { [key: string]: JSONValue } = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      json[key] = toJson(item, `${at}/${key}`);
    }
    return json;
  }
  throw new Error(`The content of ${at} is not JSON (${typeof value}).`);
}
