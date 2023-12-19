import path from "path";
import { createFixPatch, createService } from "@valbuild/server";
import { ModuleId, ModulePath, SourcePath } from "@valbuild/core";
import { glob } from "fast-glob";
import picocolors from "picocolors";
import { ESLint } from "eslint";
import fs from "fs/promises";

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
  const eslint = new ESLint({
    cwd: projectRoot,
    ignore: false,
    useEslintrc: true,
  });
  const service = await createService(projectRoot, {
    valConfigPath: cfg ?? "./val.config",
  });

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });
  console.log(picocolors.green("✔"), "Validating", valFiles.length, "files");
  const eslintResults = await eslint.lintFiles(valFiles);
  const eslintResultsByFile = eslintResults.reduce(
    (acc, result) => ({
      ...acc,
      [result.filePath.replaceAll(`${projectRoot}/`, "")]: result,
    }),
    {} as Record<string, ESLint.LintResult>
  );
  async function validateFile(file: string): Promise<number> {
    const moduleId = `/${file}`.replace(/(\.val\.(ts|js))$/, "") as ModuleId; // TODO: check if this always works? (Windows?)
    const start = Date.now();
    const valModule = await service.get(moduleId, "" as ModulePath);
    const fileContent = await fs.readFile(
      path.join(projectRoot, file),
      "utf-8"
    );
    const eslintResult = eslintResultsByFile?.[file];
    eslintResult?.messages.forEach((m) => {
      // display surrounding code
      const lines = fileContent.split("\n");
      const line = lines[m.line - 1];
      const lineBefore = lines[m.line - 2];
      const lineAfter = lines[m.line];
      const isError = m.severity >= 2;
      console.log(
        isError ? picocolors.red("✘") : picocolors.yellow("⚠"),
        isError ? "Found eslint error:" : "Found eslint warning:",
        `${moduleId}:${m.line}:${m.column}\n`,
        m.message
      );
      lineBefore &&
        console.log(picocolors.gray("  " + (m.line - 1) + " |"), lineBefore);
      line && console.log(picocolors.gray("  " + m.line + " |"), line);
      // adds ^ below the relevant line:
      line &&
        console.log(
          picocolors.gray("  " + " ".repeat(m.line.toString().length) + " |"),
          " ".repeat(m.column - 1) +
            (m.endColumn
              ? (isError ? picocolors.red("^") : picocolors.yellow("^")).repeat(
                  m.endColumn - m.column - 1
                )
              : "")
        );
      lineAfter &&
        console.log(picocolors.gray("  " + (m.line + 1) + " |"), lineAfter);
    });
    if (!valModule.errors && eslintResult?.errorCount === 0) {
      console.log(
        picocolors.green("✔"),
        moduleId,
        "is valid (",
        Date.now() - start,
        "ms)"
      );
      return 0;
    } else {
      let errors =
        eslintResultsByFile?.[file]?.messages.reduce(
          (prev, m) => (m.severity >= 2 ? prev + 1 : prev),
          0
        ) || 0;
      if (valModule.errors) {
        if (valModule.errors.validation) {
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
      } else {
        console.log(
          picocolors.green("✔"),
          moduleId,
          "is valid (",
          Date.now() - start,
          "ms)"
        );
      }
      return errors;
    }
  }

  let errors = 0;
  for (const file of valFiles) {
    errors += await validateFile(file);
  }
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
