/**
 * The typecheck, in Node, against a project installed on this machine: for a
 * build that has installed the project to build its dependency layer, so the
 * check reads the declarations that install left rather than fetching them
 * from adept. Not for a browser -- it reads the disk. The check itself is
 * `typecheckProject` from `@valbuild/shared/typecheck`, the same one the
 * Studio and the upgrade page run.
 */
export { installedSources } from "./installedSources";
export {
  typecheckInstalled,
  type InstalledTypecheck,
} from "./typecheckInstalled";
