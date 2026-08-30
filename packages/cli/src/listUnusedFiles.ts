import { ModuleFilePath, ModulePath, SourcePath } from "@valbuild/core";
import { createService } from "@valbuild/server";
import { glob } from "fast-glob";
import path from "path";
import { findAndEvalValConfigFile } from "./utils/evalValConfigFile";

export async function listUnusedFiles({ root }: { root?: string }) {
  const projectRoot = root ? path.resolve(root) : process.cwd();

  const valConfigFile = await findAndEvalValConfigFile(projectRoot);
  // Strip the leading "/" so it is relative to the project root (e.g. "public/val").
  const managedDir = (valConfigFile?.files?.directory ?? "/public/val").replace(
    /^\//,
    "",
  );

  const service = await createService(projectRoot);
  const registered = new Set<ModuleFilePath>(service.getModuleFilePaths());

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  const filesUsedByVal: string[] = [];
  async function pushFilesUsedByVal(file: string) {
    const moduleId = `/${file}` as ModuleFilePath; // TODO: check if this always works? (Windows?)
    if (!registered.has(moduleId)) {
      // Not registered in val.modules - skip (e.g. reusable schema fragments).
      return;
    }
    const valModule = await service.get(moduleId, "" as ModulePath, {
      validate: true,
    });
    // TODO: not sure using validation is the best way to do this, but it works currently.
    if (valModule.errors) {
      if (valModule.errors.validation) {
        for (const sourcePathS in valModule.errors.validation) {
          const sourcePath = sourcePathS as SourcePath;
          const validationError = valModule.errors.validation[sourcePath];
          for (const error of validationError) {
            const value = error.value;
            if (isFileRef(value)) {
              const absoluteFilePathUsedByVal = path.join(
                projectRoot,
                ...value.path.split("/"),
              );
              filesUsedByVal.push(absoluteFilePathUsedByVal);
            }
          }
        }
      }
    }
  }
  for (const file of valFiles) {
    await pushFilesUsedByVal(file);
  }

  const managedRoot = path.join(projectRoot, managedDir);
  const allFilesInManagedDir = await glob("**/*", {
    ignore: ["node_modules/**"],
    cwd: managedRoot,
  });
  for (const file of allFilesInManagedDir) {
    const absoluteFilePath = path.join(managedRoot, file);
    if (!filesUsedByVal.includes(absoluteFilePath)) {
      console.log(path.join(managedRoot, file));
    }
  }

  service.dispose();
  return;
}

/**
 * Whether a flagged validation value names a file.
 *
 * A `ValidationError` carries no schema, so the shape is all there is to go on —
 * the same heuristic this whole function documents as a TODO.
 */
function isFileRef(value: unknown): value is { path: string } {
  return (
    !!value &&
    typeof value === "object" &&
    "path" in value &&
    typeof value.path === "string"
  );
}
