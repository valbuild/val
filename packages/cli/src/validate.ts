import path from "path";
import { createFixPatch, createService } from "@valbuild/server";
import { ModuleFilePath, ModulePath, SourcePath } from "@valbuild/core";
import { glob } from "fast-glob";
import picocolors from "picocolors";
import { ESLint } from "eslint";
import fs from "fs/promises";

export async function validate({
  root,
  fix,
  noEslint,
}: {
  root?: string;
  fix?: boolean;
  noEslint?: boolean;
}) {
  const projectRoot = root ? path.resolve(root) : process.cwd();
  const eslint = new ESLint({
    cwd: projectRoot,
    ignore: false,
    useEslintrc: true,
  });
  const service = await createService(projectRoot, {});

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  let errors = 0;
  let eslintResults: ESLint.LintResult[] = [];
  let eslintResultsByFile: Record<string, ESLint.LintResult> = {};
  if (!noEslint) {
    const lintFiles = await glob("**/*.{js,ts}", {
      ignore: ["node_modules/**"],
      cwd: projectRoot,
    });
    console.log("Running eslint...");
    eslintResults = await eslint.lintFiles(lintFiles);

    eslintResultsByFile = eslintResults.reduce(
      (acc, result) => ({
        ...acc,
        [result.filePath.replaceAll(`${projectRoot}/`, "")]: result,
      }),
      {} as Record<string, ESLint.LintResult>
    );
    eslintResults.forEach((result) => {
      result.messages.forEach(async (m) => {
        if (m.messageId === "val/export-content-must-be-valid") {
          errors += 1;
          logEslintMessage(
            await fs.readFile(result.filePath, "utf-8"),
            result.filePath,
            m
          );
        }
      });
    });
    console.log(
      errors === 0 ? picocolors.green("✔") : picocolors.red("✘"),
      "ESlint complete",
      lintFiles.length,
      "files"
    );
  }
  console.log("Validating...", valFiles.length, "files");

  async function validateFile(file: string): Promise<number> {
    const moduleId = `/${file}`.replace(
      /(\.val\.(ts|js))$/,
      ""
    ) as ModuleFilePath; // TODO: check if this always works? (Windows?)
    const start = Date.now();
    const valModule = await service.get(moduleId, "" as ModulePath, {
      source: true,
      schema: true,
      validate: true,
    });
    const fileContent = await fs.readFile(
      path.join(projectRoot, file),
      "utf-8"
    );
    const eslintResult = eslintResultsByFile?.[file];
    eslintResult?.messages.forEach((m) => {
      // display surrounding code
      logEslintMessage(fileContent, moduleId, m);
    });
    if (!valModule.errors && eslintResult?.errorCount === 0) {
      console.log(
        picocolors.green("✔"),
        moduleId,
        "is valid (" + (Date.now() - start) + "ms)"
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
                    picocolors.yellow("⚠"),
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
          "is valid (" + (Date.now() - start) + "ms)"
        );
      }
      return errors;
    }
  }
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

function logEslintMessage(
  fileContent: string,
  filePath: string,
  eslintMessage: ESLint.LintResult["messages"][number]
) {
  const lines = fileContent.split("\n");
  const line = lines[eslintMessage.line - 1];
  const lineBefore = lines[eslintMessage.line - 2];
  const lineAfter = lines[eslintMessage.line];
  const isError = eslintMessage.severity >= 2;
  console.log(
    isError ? picocolors.red("✘") : picocolors.yellow("⚠"),
    isError ? "Found eslint error:" : "Found eslint warning:",
    `${filePath}:${eslintMessage.line}:${eslintMessage.column}\n`,
    eslintMessage.message
  );
  lineBefore &&
    console.log(
      picocolors.gray("  " + (eslintMessage.line - 1) + " |"),
      lineBefore
    );
  line && console.log(picocolors.gray("  " + eslintMessage.line + " |"), line);
  // adds ^ below the relevant line:
  const amountOfColumns =
    eslintMessage.endColumn &&
    eslintMessage.endColumn - eslintMessage.column > 0
      ? eslintMessage.endColumn - eslintMessage.column
      : 1;

  line &&
    console.log(
      picocolors.gray(
        "  " + " ".repeat(eslintMessage.line.toString().length) + " |"
      ),
      " ".repeat(eslintMessage.column - 1) +
        (eslintMessage.endColumn
          ? (isError ? picocolors.red("^") : picocolors.yellow("^")).repeat(
              amountOfColumns
            )
          : "")
    );
  lineAfter &&
    console.log(
      picocolors.gray("  " + (eslintMessage.line + 1) + " |"),
      lineAfter
    );
}
