import { ModuleFilePath, SerializedSchema } from "@valbuild/core";
import { MediaModule, NavItemErrors } from "./types";

/**
 * Whether a module is an `s.images()` / `s.files()` gallery.
 *
 * Both are records with a `mediaType` marker on the SERIALIZED schema, so this
 * needs no sources and costs nothing per keystroke.
 */
export function isGallerySchema(
  schema: SerializedSchema | undefined,
): schema is SerializedSchema & {
  type: "record";
  mediaType: "files" | "images";
} {
  return schema?.type === "record" && !!schema.mediaType;
}

/**
 * The project's galleries, labelled by the directory each is constrained to -
 * which is the unit an editor thinks in, rather than the `.val.ts` declaring it.
 */
export function collectMediaModules(
  schemas: Record<ModuleFilePath, SerializedSchema>,
  collectErrors: (moduleFilePath: ModuleFilePath) => NavItemErrors | undefined,
): MediaModule[] {
  const media: MediaModule[] = [];
  for (const moduleFilePathS in schemas) {
    const moduleFilePath = moduleFilePathS as ModuleFilePath;
    const schema = schemas[moduleFilePath];
    if (!isGallerySchema(schema)) {
      continue;
    }
    media.push({
      moduleFilePath,
      // A gallery without an explicit directory is still a gallery; fall back to
      // the module path so the row has something to identify it by.
      directory: schema.directory ?? moduleFilePath,
      mediaType: schema.mediaType,
      // An external gallery's files are behind an adapter Val cannot write to
      // yet, and a readonly one is not writable by definition. Both still list
      // and still open — only uploading is off.
      canUpload: schema.readonly !== true && schema.external === undefined,
      errors: collectErrors(moduleFilePath),
    });
  }
  return media.sort((a, b) => a.directory.localeCompare(b.directory));
}

/**
 * Drops the given paths from a path tree.
 *
 * Gallery modules live under Media, so they are not also files in the explorer
 * tree: two entry points for one module is confusing, and the explorer one opens
 * a record of file paths rather than the gallery.
 */
export function excludePathsFromTree<
  T extends { fullPath: string; children: T[] },
>(node: T, excludedPaths: ReadonlySet<string>): T {
  return {
    ...node,
    children: node.children
      .filter((child) => !excludedPaths.has(child.fullPath))
      .map((child) => excludePathsFromTree(child, excludedPaths)),
  };
}
