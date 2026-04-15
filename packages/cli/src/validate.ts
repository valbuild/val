import path from "path";
import picocolors from "picocolors";
import fs from "fs/promises";
import { glob } from "fast-glob";
import { DEFAULT_CONTENT_HOST, DEFAULT_VAL_REMOTE_HOST } from "@valbuild/core";
import { getSettings, uploadRemoteFile } from "@valbuild/server";
import { evalValConfigFile } from "./utils/evalValConfigFile";
import { createDefaultValFSHost, runValidation } from "./runValidation";

export async function validate({
  root,
  fix,
}: {
  root?: string;
  fix?: boolean;
}) {
  const projectRoot = root ? path.resolve(root) : process.cwd();

  const valConfigFile =
    (await evalValConfigFile(projectRoot, "val.config.ts")) ||
    (await evalValConfigFile(projectRoot, "val.config.js"));

  const resolvedValConfigFile = valConfigFile
    ? {
        ...valConfigFile,
        project: process.env.VAL_PROJECT || valConfigFile.project,
      }
    : process.env.VAL_PROJECT
      ? { project: process.env.VAL_PROJECT }
      : undefined;

  console.log(
    picocolors.greenBright(
      `Validating project${resolvedValConfigFile?.project ? ` '${picocolors.inverse(resolvedValConfigFile.project)}'` : ""}...`,
    ),
  );

  const valFiles: string[] = await glob("**/*.val.{js,ts}", {
    ignore: ["node_modules/**"],
    cwd: projectRoot,
  });

  console.log(picocolors.greenBright(`Found ${valFiles.length} files...`));

  let prettier;
  try {
    prettier = (await import("prettier")).default;
  } catch {
    console.log("Prettier not found, skipping formatting");
  }

  const fixedFiles = new Set<string>();
  let totalErrors = 0;

  for await (const event of runValidation({
    root: projectRoot,
    fix: !!fix,
    valFiles,
    project: resolvedValConfigFile?.project,
    remote: {
      remoteHost: process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
      getSettings: (projectName, options) => getSettings(projectName, options),
      uploadFile: (project, bucket, fileHash, fileExt, fileBuffer, options) =>
        uploadRemoteFile(
          process.env.VAL_CONTENT_URL || DEFAULT_CONTENT_HOST,
          project,
          bucket,
          fileHash,
          fileExt ?? "",
          fileBuffer,
          options,
        ),
    },
    fs: createDefaultValFSHost(),
  })) {
    switch (event.type) {
      case "file-valid":
        console.log(
          picocolors.green("✔"),
          event.file,
          "is valid (" + event.durationMs + "ms)",
        );
        break;
      case "file-error-count":
        console.log(
          picocolors.red("✘"),
          `${event.file} contains ${event.errorCount} error${event.errorCount > 1 ? "s" : ""}`,
          " (" + event.durationMs + "ms)",
        );
        totalErrors += event.errorCount;
        break;
      case "validation-error":
        console.log(
          picocolors.red("✘"),
          "Got error in",
          `${event.sourcePath}:`,
          event.message,
        );
        break;
      case "validation-fixable-error":
        console.log(
          event.fixable ? picocolors.yellow("⚠") : picocolors.red("✘"),
          `Got ${event.fixable ? "fixable " : ""}error in`,
          `${event.sourcePath}:`,
          event.message,
        );
        break;
      case "unknown-fix":
        console.log(
          picocolors.red("✘"),
          "Unknown fix",
          event.fixes,
          "for",
          event.sourcePath,
        );
        break;
      case "fix-applied":
        console.log(
          picocolors.yellow("⚠"),
          "Applied fix for",
          event.sourcePath,
        );
        fixedFiles.add(event.file);
        break;
      case "fatal-error":
        console.log(
          picocolors.red("✘"),
          event.file,
          "is invalid:",
          event.message,
        );
        break;
      case "remote-uploading":
        console.log(
          picocolors.yellow("⚠"),
          `Uploading remote file: '${event.ref}'...`,
        );
        break;
      case "remote-uploaded":
        console.log(
          picocolors.green("✔"),
          `Completed upload of remote file: '${event.ref}'`,
        );
        break;
      case "remote-already-uploaded":
        console.log(
          picocolors.yellow("⚠"),
          `Remote file ${event.filePath} already uploaded`,
        );
        break;
      case "remote-downloading":
        console.log(
          picocolors.yellow("⚠"),
          `Downloading remote file in ${event.sourcePath}...`,
        );
        break;
      case "summary-errors":
      case "summary-success":
        break;
    }
  }

  // Run prettier on files that had fixes applied
  if (prettier) {
    for (const file of fixedFiles) {
      const filePath = path.join(projectRoot, file);
      const fileContent = await fs.readFile(filePath, "utf-8");
      const formattedContent = await prettier.format(fileContent, {
        filepath: filePath,
      });
      await fs.writeFile(filePath, formattedContent);
    }
  }

  if (totalErrors > 0) {
    console.log(
      picocolors.red("✘"),
      "Got",
      totalErrors,
      "error" + (totalErrors > 1 ? "s" : ""),
    );
    process.exit(1);
  } else {
    console.log(picocolors.green("✔"), "No validation errors found");
  }
}
