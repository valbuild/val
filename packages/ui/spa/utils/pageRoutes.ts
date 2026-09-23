import {
  Internal,
  isPageRouter,
  type ModuleFilePath,
  type SerializedSchema,
  type SourcePath,
} from "@valbuild/core";

/**
 * Whether a module's keys are URLs of this site.
 *
 * `isPageRouter` is the single answer to that question — the sitemap, the Pages
 * menu and the add-a-page form all go through it — so this is a thin read of
 * the serialized schema rather than a second opinion. A record without a
 * router is data whose keys happen to be strings; a record with one is the
 * site's pages, and the two must not be named the same way.
 */
export function isPageModule(schema: SerializedSchema | undefined): boolean {
  return (
    schema !== undefined &&
    schema.type === "record" &&
    schema.router !== undefined &&
    isPageRouter(schema.router)
  );
}

/**
 * The page a changed path belongs to — its URL — or null when it is not in one.
 *
 * A router module is ONE module holding MANY pages, which is why every surface
 * that lists changes by module got this wrong in the same way: three edits to
 * three different pages came out as three rows called `page`, because that is
 * what the file is called. The thing that changed is the page, and a page is
 * named by its URL.
 *
 * The first segment, because a router record's keys ARE the routes: everything
 * below the first segment is inside one page.
 */
export function pageRouteOf(
  sourcePath: SourcePath | ModuleFilePath,
  isPage: boolean,
): string | null {
  if (!isPage) return null;
  const [, modulePath] = Internal.splitModuleFilePathAndModulePath(
    sourcePath as SourcePath,
  );
  if (!modulePath) return null;
  const [route] = Internal.splitModulePath(modulePath);
  return route ?? null;
}

/** The source path of a page itself, given one of the paths inside it. */
export function pagePathOf(sourcePath: SourcePath, route: string): SourcePath {
  const [moduleFilePath] =
    Internal.splitModuleFilePathAndModulePath(sourcePath);
  return Internal.joinModuleFilePathAndModulePath(
    moduleFilePath,
    Internal.patchPathToModulePath([route]),
  );
}
