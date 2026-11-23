import * as fs from "node:fs";
import * as path from "node:path";
import {
  typecheckProject,
  type TypecheckProgress,
  type TypecheckResult,
} from "../typecheckProject";
import { installedSources } from "./installedSources";

/** What a typecheck of an installed project came to. */
export type InstalledTypecheck =
  | { status: "checked"; result: TypecheckResult }
  /** No lockfile beside `package.json` to compute the layout from: not pnpm, or a package in a workspace. */
  | { status: "skipped"; reason: string }
  /** The check could not run: the lockfile, the layout or TypeScript failed it. */
  | { status: "failed"; message: string };

const readIfThere = (file: string): string | null => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/**
 * The typecheck of a project that is installed on this machine: `files` with
 * the declarations read from its own `node_modules` (`installedSources`),
 * through the one `typecheckProject` every other caller runs.
 *
 * Made for a build that installs the project to build its dependency layer:
 * the install is the expensive part, and the typecheck can reuse it instead
 * of fetching every declaration again from adept later, in a tab that has to
 * stay open for it.
 *
 * `files` is what the caller wants checked, not the directory: a build checks
 * what it builds, which can differ from what is on disk (a wired
 * `val.server.ts`, a generated route tree). The lockfile and
 * `pnpm-workspace.yaml` are read from `root`, because the layout is computed
 * from them, as it is everywhere else. Never throws: a check that could not
 * run is `failed`, so a build can carry on without it.
 */
export async function typecheckInstalled(options: {
  root: string;
  files: Record<string, string>;
  onProgress?: (progress: TypecheckProgress) => void;
}): Promise<InstalledTypecheck> {
  const root = path.resolve(options.root);
  const lockfile = readIfThere(path.join(root, "pnpm-lock.yaml"));
  if (lockfile === null) {
    return {
      status: "skipped",
      reason:
        "there is no pnpm-lock.yaml beside its package.json, and only a pnpm project with its own lockfile is typechecked",
    };
  }
  try {
    const result = await typecheckProject({
      files: options.files,
      lockfile,
      workspace: readIfThere(path.join(root, "pnpm-workspace.yaml")),
      sources: installedSources(root),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    return { status: "checked", result };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
