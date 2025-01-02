import path from "path";
import { createFixPatch, createService } from "@valbuild/server";
import {
  FILE_REF_PROP,
  Internal,
  ModuleFilePath,
  ModulePath,
  SourcePath,
  ValidationFix,
} from "@valbuild/core";
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
  });
  const service = await createService(projectRoot, {});
  const checkKeyIsValid = async (
    key: string,
    sourcePath: string,
  ): Promise<{ error: false } | { error: true; message: string }> => {
    const [moduleFilePath, modulePath] =
      Internal.splitModuleFilePathAndModulePath(sourcePath as SourcePath);
    const keyOfModule = await service.get(moduleFilePath, modulePath, {
      source: true,
      schema: false,
      validate: false,
    });

    const keyOfModuleSource = keyOfModule.source;
    const keyOfModuleSchema = keyOfModule.schema;
    if (keyOfModuleSchema && keyOfModuleSchema.type !== "record") {
      return {
        error: true,
        message: `Expected key at ${sourcePath} to be of type 'record'`,
      };
    }
    if (
      keyOfModuleSource &&
      typeof keyOfModuleSource === "object" &&
      key in keyOfModuleSource
    ) {
      return { error: false };
    }
    if (!keyOfModuleSource || typeof keyOfModuleSource !== "object") {
      return {
        error: true,
        message: `Expected ${sourcePath} to be a truthy object`,
      };
    }
    const alternatives = findSimilar(key, Object.keys(keyOfModuleSource));
    return {
      error: true,
      message: `Key '${key}' does not exist in ${sourcePath}. Closest match: '${alternatives[0].target}'. Other similar: ${alternatives
        .slice(1, 4)
        .map((a) => `'${a.target}'`)
        .join(", ")}${alternatives.length > 4 ? ", ..." : ""}`,
    };
  };
  let prettier;
  try {
    prettier = (await import("prettier")).default;
  } catch {
    console.log("Prettier not found, skipping formatting");
  }

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
      {} as Record<string, ESLint.LintResult>,
    );
    eslintResults.forEach((result) => {
      result.messages.forEach(async (m) => {
        if (m.messageId === "val/export-content-must-be-valid") {
          errors += 1;
          logEslintMessage(
            await fs.readFile(result.filePath, "utf-8"),
            result.filePath,
            m,
          );
        }
      });
    });
    console.log(
      errors === 0 ? picocolors.green("✔") : picocolors.red("✘"),
      "ESlint complete",
      lintFiles.length,
      "files",
    );
  }
  console.log("Validating...", valFiles.length, "files");

  let didFix = false; // TODO: ugly
  async function validateFile(file: string): Promise<number> {
    const moduleFilePath = `/${file}` as ModuleFilePath; // TODO: check if this always works? (Windows?)
    const start = Date.now();
    const valModule = await service.get(moduleFilePath, "" as ModulePath, {
      source: true,
      schema: true,
      validate: true,
    });
    const fileContent = await fs.readFile(
      path.join(projectRoot, file),
      "utf-8",
    );
    const eslintResult = eslintResultsByFile?.[file];
    eslintResult?.messages.forEach((m) => {
      // display surrounding code
      logEslintMessage(fileContent, moduleFilePath, m);
    });
    if (!valModule.errors && eslintResult?.errorCount === 0) {
      console.log(
        picocolors.green("✔"),
        moduleFilePath,
        "is valid (" + (Date.now() - start) + "ms)",
      );
      return 0;
    } else {
      let errors =
        eslintResultsByFile?.[file]?.messages.reduce(
          (prev, m) => (m.severity >= 2 ? prev + 1 : prev),
          0,
        ) || 0;
      if (valModule.errors) {
        if (valModule.errors.validation) {
          for (const [sourcePath, validationErrors] of Object.entries(
            valModule.errors.validation,
          )) {
            for (const v of validationErrors) {
              if (v.fixes && v.fixes.length > 0) {
                if (
                  v.fixes.includes(
                    "image:replace-metadata" as ValidationFix, // TODO: we can remove this now - we needed before because we changed the name of the fix from replace-metadata to check-metadata
                  ) ||
                  v.fixes.includes("image:check-metadata") ||
                  v.fixes.includes("image:add-metadata") ||
                  v.fixes.includes("file:check-metadata") ||
                  v.fixes.includes("file:add-metadata")
                ) {
                  const [, modulePath] =
                    Internal.splitModuleFilePathAndModulePath(
                      sourcePath as SourcePath,
                    );
                  if (valModule.source && valModule.schema) {
                    const fileSource = Internal.resolvePath(
                      modulePath,
                      valModule.source,
                      valModule.schema,
                    );
                    const filePath = path.join(
                      projectRoot,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (fileSource.source as any)?.[FILE_REF_PROP],
                    );
                    try {
                      await fs.access(filePath);
                    } catch {
                      console.log(
                        picocolors.red("✘"),
                        `File ${filePath} does not exist`,
                      );
                      errors += 1;
                      continue;
                    }
                  }
                } else if (v.fixes.includes("keyof:check-keys")) {
                  const prevErrors = errors;
                  if (
                    v.value &&
                    typeof v.value === "object" &&
                    "key" in v.value &&
                    "sourcePath" in v.value
                  ) {
                    const { key, sourcePath } = v.value;
                    if (typeof key !== "string") {
                      console.log(
                        picocolors.red("✘"),
                        "Unexpected error in",
                        `${sourcePath}:`,
                        v.message,
                        " (Expected value property 'key' to be a string - this is likely a bug in Val)",
                      );
                      errors += 1;
                    } else if (typeof sourcePath !== "string") {
                      console.log(
                        picocolors.red("✘"),
                        "Unexpected error in",
                        `${sourcePath}:`,
                        v.message,
                        " (Expected value property 'sourcePath' to be a string - this is likely a bug in Val)",
                      );
                      errors += 1;
                    } else {
                      const res = await checkKeyIsValid(key, sourcePath);
                      if (res.error) {
                        console.log(picocolors.red("✘"), res.message);
                        errors += 1;
                      }
                    }
                  } else {
                    console.log(
                      picocolors.red("✘"),
                      "Unexpected error in",
                      `${sourcePath}:`,
                      v.message,
                      " (Expected value to be an object with 'key' and 'sourcePath' properties - this is likely a bug in Val)",
                    );
                    errors += 1;
                  }
                  if (prevErrors < errors) {
                    console.log(
                      picocolors.red("✘"),
                      "Found error in",
                      `${sourcePath}`,
                    );
                } else if (v.fixes.includes("image:upload-remote")) {
                  const [, modulePath] =
                    Internal.splitModuleFilePathAndModulePath(
                      sourcePath as SourcePath,
                    );
                  if (valModule.source && valModule.schema) {
                    const fileSource = Internal.resolvePath(
                      modulePath,
                      valModule.source,
                      valModule.schema,
                    );
                    const filePath = path.join(
                      projectRoot,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (fileSource.source as any)?.[FILE_REF_PROP],
                    );
                    try {
                      await fs.access(filePath);
                    } catch {
                      console.log(
                        picocolors.red("✘"),
                        `File ${filePath} does not exist`,
                      );
                      errors += 1;
                      continue;
                    }
                    console.log("TODO: check if logged in to project");
                    console.log("TODO: upload remote file");
                    throw Error("Not implemented");
                  }
                } else {
                  console.log(
                    picocolors.red("✘"),
                    "Unknown fix",
                    v.fixes,
                    "for",
                    sourcePath,
                  );
                  errors += 1;
                  continue;
                }
                const fixPatch = await createFixPatch(
                  { projectRoot },
                  !!fix,
                  sourcePath as SourcePath,
                  v,
                );
                if (fix && fixPatch?.patch && fixPatch?.patch.length > 0) {
                  await service.patch(moduleFilePath, fixPatch.patch);
                  didFix = true;
                  console.log(
                    picocolors.yellow("⚠"),
                    "Applied fix for",
                    sourcePath,
                  );
                }
                fixPatch?.remainingErrors?.forEach((e) => {
                  errors += 1;
                  console.log(
                    v.fixes ? picocolors.yellow("⚠") : picocolors.red("✘"),
                    `Found ${v.fixes ? "fixable " : ""}error in`,
                    `${sourcePath}:`,
                    e.message,
                  );
                });
              } else {
                errors += 1;
                console.log(
                  picocolors.red("✘"),
                  "Found error in",
                  `${sourcePath}:`,
                  v.message,
                );
              }
            }
          }
        }
        for (const fatalError of valModule.errors.fatal || []) {
          errors += 1;
          console.log(
            picocolors.red("✘"),
            moduleFilePath,
            "is invalid:",
            fatalError.message,
          );
        }
      } else {
        console.log(
          picocolors.green("✔"),
          moduleFilePath,
          "is valid (" + (Date.now() - start) + "ms)",
        );
      }
      return errors;
    }
  }

  for (const file of valFiles.sort()) {
    didFix = false;
    errors += await validateFile(file);
    if (prettier && didFix) {
      const filePath = path.join(projectRoot, file);
      const fileContent = await fs.readFile(filePath, "utf-8");
      const formattedContent = await prettier?.format(fileContent, {
        filepath: filePath,
      });
      await fs.writeFile(filePath, formattedContent);
    }
  }
  if (errors > 0) {
    console.log(
      picocolors.red("✘"),
      "Found",
      errors,
      "validation error" + (errors > 1 ? "s" : ""),
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
  eslintMessage: ESLint.LintResult["messages"][number],
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
    eslintMessage.message,
  );
  if (lineBefore) {
    console.log(
      picocolors.gray("  " + (eslintMessage.line - 1) + " |"),
      lineBefore,
    );
  }
  if (line) {
    console.log(picocolors.gray("  " + eslintMessage.line + " |"), line);
  }
  // adds ^ below the relevant line:
  const amountOfColumns =
    eslintMessage.endColumn &&
    eslintMessage.endColumn - eslintMessage.column > 0
      ? eslintMessage.endColumn - eslintMessage.column
      : 1;

  if (line) {
    console.log(
      picocolors.gray(
        "  " + " ".repeat(eslintMessage.line.toString().length) + " |",
      ),
      " ".repeat(eslintMessage.column - 1) +
        (eslintMessage.endColumn
          ? (isError ? picocolors.red("^") : picocolors.yellow("^")).repeat(
              amountOfColumns,
            )
          : ""),
    );
  }
  if (lineAfter) {
    console.log(
      picocolors.gray("  " + (eslintMessage.line + 1) + " |"),
      lineAfter,
    );
  }
}

// GPT generated levenshtein distance algorithm:
const levenshtein = (a: string, b: string): number => {
  const [m, n] = [a.length, b.length];
  if (!m || !n) return Math.max(m, n);

  const dp = Array.from({ length: m + 1 }, (_, i) => i);

  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;

    for (let i = 1; i <= m; i++) {
      const temp = dp[i];
      dp[i] =
        a[i - 1] === b[j - 1]
          ? prev
          : Math.min(prev + 1, dp[i - 1] + 1, dp[i] + 1);
      prev = temp;
    }
  }

  return dp[m];
};

function findSimilar(key: string, targets: string[]) {
  return targets
    .map((target) => ({ target, distance: levenshtein(key, target) }))
    .sort((a, b) => a.distance - b.distance);
}
