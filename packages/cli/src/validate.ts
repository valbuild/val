import path from "path";
import { createFixPatch, createService } from "@valbuild/server";
import { ModuleId, ModulePath, SourcePath } from "@valbuild/core";
import { glob } from "glob";

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

  const valFiles: string[] = await new Promise((resolve, reject) =>
    glob(
      "**/*.val.{js,ts}",
      { ignore: "node_modules/**", root: projectRoot },
      (err, matches) => {
        if (err) {
          reject(err);
        } else {
          resolve(matches);
        }
      }
    )
  );
  console.log(valFiles);
  async function validateFile(file: string) {
    console.log(file);
    const moduleId = `/${file}`.replace(/(\.val\.(ts|js))$/, "") as ModuleId; // TODO: check if this always works? (Windows?)
    console.time(`eval:${moduleId}`);
    const valModule = await service.get(moduleId, "" as ModulePath);
    console.timeEnd(`eval:${moduleId}`);
    // console.log(JSON.stringify(valModule, null, 2));
    if (valModule.errors && valModule.errors.validation) {
      for (const [sourcePath, validationErrors] of Object.entries(
        valModule.errors.validation
      )) {
        for (const v of validationErrors) {
          const fixPatch = await createFixPatch(
            { projectRoot },
            sourcePath as SourcePath,
            v
          );
          if (fix && fixPatch?.patch) {
            await service.patch(moduleId, fixPatch.patch);
            console.log("patched", moduleId);
          }

          // console.log(
          //   JSON.stringify(
          //     await createFixPatch(
          //       { projectRoot },
          //       sourcePath as SourcePath,
          //       v
          //     ),
          //     null,
          //     2
          //   )
          // );
        }
      }
    }
  }

  console.time("validate");
  await Promise.all(valFiles.map(validateFile));
  console.timeEnd("validate");
  service.dispose();
  return;
}
