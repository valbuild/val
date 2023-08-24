import path from "path";
import { createFixPatch, createService } from "@valbuild/server";
import { ModuleId, ModulePath, SourcePath } from "@valbuild/core";
import { glob } from "glob";
import picocolors from "picocolors";

export async function validate({
  root,
  cfg,
  fix,
}: {
  root?: string;
  cfg?: string;
  fix?: boolean;
}) {
  const projectRoot = root ? path.resolve(root) : process.cwd();
  const service = await createService(projectRoot, {
    valConfigPath: cfg ?? "./val.config",
  });

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: "node_modules/**",
    root: projectRoot,
  });
  console.log(picocolors.green("✔"), "Validating", valFiles.length, "files");

  async function validateFile(file: string): Promise<number> {
    const moduleId = `/${file}`.replace(/(\.val\.(ts|js))$/, "") as ModuleId; // TODO: check if this always works? (Windows?)
    const start = Date.now();
    const valModule = await service.get(moduleId, "" as ModulePath);

    if (!valModule.errors) {
      console.log(
        picocolors.green("✔"),
        moduleId,
        "is valid (",
        Date.now() - start,
        "ms)"
      );
      return 0;
    } else {
      let errors = 0;
      if (valModule.errors.validation)
        for (const [sourcePath, validationErrors] of Object.entries(
          valModule.errors.validation
        )) {
          for (const v of validationErrors) {
            if (v.fixes && v.fixes.length > 0) {
              const fixPatch = await createFixPatch(
                { projectRoot },
                !!fix,
                sourcePath as SourcePath,
                v
              );
              if (fix && fixPatch?.patch && fixPatch?.patch.length > 0) {
                await service.patch(moduleId, fixPatch.patch);
                console.log(
                  picocolors.green("✔"),
                  "Applied fix for",
                  sourcePath
                );
              }
              fixPatch?.remainingErrors?.forEach((e) => {
                errors += 1;
                console.log(
                  v.fixes ? picocolors.yellow("⚠") : picocolors.red("✘"),
                  `Found ${v.fixes ? "fixable " : ""}error in`,
                  `${sourcePath}:`,
                  e.message
                );
              });
            } else {
              errors += 1;
              console.log(
                picocolors.red("✘"),
                "Found error in",
                `${sourcePath}:`,
                v.message
              );
            }
          }
        }
      for (const fatalError of valModule.errors.fatal || []) {
        errors += 1;
        console.log(
          picocolors.red("✘"),
          moduleId,
          "is invalid:",
          fatalError.message
        );
      }
      return errors;
    }
  }

  const errors = (await Promise.all(valFiles.map(validateFile))).reduce(
    (a, b) => a + b,
    0
  );
  if (errors > 0) {
    console.log(
      picocolors.red("✘"),
      "Found",
      errors,
      "validation error" + (errors > 1 ? "s" : "")
    );
    process.exit(1);
  } else {
    console.log(picocolors.green("✔"), "No validation errors found");
  }

  service.dispose();
  return;
}
