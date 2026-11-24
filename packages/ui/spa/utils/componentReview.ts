import {
  Internal,
  isPageRouter,
  type Json,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";

/**
 * The route in the host app that renders the value at one source path with
 * its component, alone (`src/routes/val-preview.tsx` in the TanStack example,
 * `app/val-preview/page.tsx` in the Next one).
 *
 * Hard-coded while the setup story is worked out, as it was for the preview
 * beside the fields: see `architecture/render-and-preview.md`.
 */
export const VAL_COMPONENT_PREVIEW_ROUTE = "/val-preview";

/**
 * Where the preview route renders `path`: its content, or with `example`,
 * that one of `.component(load, { examples })` instead - looked up through
 * `path`, since which component a union's item is depends on its value.
 */
export function componentPreviewUrl(
  path: SourcePath,
  example: string | null,
): string {
  const query = new URLSearchParams({ p: path });
  if (example !== null) {
    query.set("example", example);
  }
  return `${VAL_COMPONENT_PREVIEW_ROUTE}?${query.toString()}`;
}

/**
 * The page an instance is on, when its module is a router of this site's
 * pages: the route, which is the first key under the module's root.
 * `null` for a module that is not a page router.
 */
export function pageRouteOf(
  path: SourcePath,
  schemas: Record<ModuleFilePath, SerializedSchema>,
): string | null {
  const [moduleFilePath, modulePath] =
    Internal.splitModuleFilePathAndModulePath(path);
  const root = schemas[moduleFilePath];
  if (
    root === undefined ||
    root.type !== "record" ||
    root.router === undefined ||
    !isPageRouter(root.router) ||
    !modulePath
  ) {
    return null;
  }
  const [route] = Internal.splitModulePath(modulePath);
  return route ?? null;
}

/**
 * Something to tell one instance from another by, read off its content when
 * there is no preview: its first non-empty string that is not its kind (a
 * union's tag is the same for every instance of a component).
 */
export function contentLabelOf(source: Json | undefined): string | null {
  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    return null;
  }
  for (const value of Object.values(source)) {
    if (typeof value === "string" && value.trim().length > 0) {
      const text = value.trim();
      // A short lower-case word is a tag ("hero"), not something written
      if (/^[a-z][a-z0-9-]*$/.test(text) && text.length <= 20) {
        continue;
      }
      return text.length > 80 ? text.slice(0, 79) + "…" : text;
    }
  }
  return null;
}
