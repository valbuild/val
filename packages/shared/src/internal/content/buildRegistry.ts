/**
 * Where a build's `val.modules` registry can be imported from: phase 9 of
 * `docs/plans/one-content-model.md`, "Reloading the schema while the Studio
 * runs".
 *
 * A build made by `@valbuild/tanstack-build` (every build the platform
 * serves) emits its `val.modules` as an ES module of its own beside its
 * client chunks, named after the build: `/_app/val-modules-<build>.js`,
 * whose default export is the registry. The server running that build knows
 * its name (`VAL_BUILD`, Val's `publishBuild`) and names the entry on
 * `GET /manifest` (`registry`), so a Studio opened on an older build imports
 * the new one's code and reloads it in place (`HostStore.reloadCode`)
 * instead of being told to reload the page.
 *
 * The convention is the builder's and this file's together: the builder
 * writes the file (`valModulesEntryFile` in `@valbuild/tanstack-build`'s
 * constants, which does not depend on this package), and a test in
 * `@valbuild/ui`, which depends on both, pins the two names equal.
 */

/** The file a build's registry is emitted as, among its client chunks. */
export function valModulesEntryFile(build: string): string {
  return `val-modules-${build}.js`;
}

/** Where a build served by the platform serves its registry. */
export function valModulesEntryPath(build: string): string {
  return `/_app/${valModulesEntryFile(build)}`;
}

/**
 * What `GET /manifest` says about the code of the build that answered:
 * where its registry is, and which Val it runs. A Studio running another
 * Val cannot take the build's code in (its own stores would run against a
 * new core), so it reloads itself instead (`other-val-version`).
 */
export type BuildRegistry = {
  /** The registry's entry, from the site's origin. */
  entry: string;
  /** `@valbuild/core`'s version, as the build runs it. */
  core: string;
};
