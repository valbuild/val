import {
  FILE_REF_PROP,
  ModuleId,
  ModulePath,
  SourcePath,
  VAL_EXTENSION,
} from "@valbuild/core";
import { createService } from "@valbuild/server";
import { glob } from "fast-glob";
import path from "path";

export async function files({
  root,
  cfg,
  managedDir,
}: {
  root?: string;
  cfg?: string;
  managedDir?: string;
}) {
  const printFilesUsedByVal = !managedDir;
  const projectRoot = root ? path.resolve(root) : process.cwd();

  const service = await createService(projectRoot, {
    valConfigPath: cfg ?? "./val.config",
  });

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  const absoluteFilesPathUsedByVal: string[] = [];
  async function printOrGetFileRefs(file: string) {
    const moduleId = `/${file}`.replace(/(\.val\.(ts|js))$/, "") as ModuleId; // TODO: check if this always works? (Windows?)
    const valModule = await service.get(moduleId, "" as ModulePath);
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
                ...value[FILE_REF_PROP].split("/")
              );
              if (printFilesUsedByVal) {
                console.log(absoluteFilePathUsedByVal);
              } else {
                absoluteFilesPathUsedByVal.push(absoluteFilePathUsedByVal);
              }
            }
          }
        }
      }
    }
  }
  for (const file of valFiles) {
    await printOrGetFileRefs(file);
  }

  if (managedDir) {
    const managedRoot = path.isAbsolute(managedDir)
      ? managedDir
      : path.join(projectRoot, managedDir);
    const allFilesInManagedDir = await glob("**/*", {
      ignore: ["node_modules/**"],
      cwd: managedRoot,
    });
    for (const file of allFilesInManagedDir) {
      const absoluteFilePath = path.join(managedRoot, file);
      if (!absoluteFilesPathUsedByVal.includes(absoluteFilePath)) {
        console.log(path.join(managedRoot, file));
      }
    }
  }

  service.dispose();
  return;
}

function isFileRef(
  value: unknown
): value is { [FILE_REF_PROP]: string; [VAL_EXTENSION]: "file" } {
  if (!value) return false;
  if (typeof value !== "object") return false;
  if (FILE_REF_PROP in value && VAL_EXTENSION in value) {
    if (
      value[VAL_EXTENSION] === "file" &&
      typeof value[FILE_REF_PROP] === "string"
    ) {
      return true;
    }
  }
  return false;
}
