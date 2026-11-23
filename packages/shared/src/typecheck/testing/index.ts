/**
 * For tests and scripts, in Node: type bundles cut from an installed
 * project's own `node_modules`, as adept cuts them from tarballs. Not for a
 * browser -- it reads the disk.
 *
 * `nodeModulesSources` is `installedSources` from
 * `@valbuild/shared/typecheck/node`, by the name it had here first.
 */
export { installedSources as nodeModulesSources } from "../node/installedSources";
