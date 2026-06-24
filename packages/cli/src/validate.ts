import path from "path";
import picocolors from "picocolors";
import fs from "fs/promises";
import { glob } from "fast-glob";
import { DEFAULT_CONTENT_HOST, DEFAULT_VAL_REMOTE_HOST } from "@valbuild/core";
import { getSettings, uploadRemoteFile } from "@valbuild/server";
import { evalValConfigFile } from "./utils/evalValConfigFile";
import { createDefaultValFSHost, runValidation } from "./runValidation";
import {
  sourcePathToCodeFrame,
  sourcePathToFileLocation,
  type SourceFileCache,
} from "./utils/sourcePathToFileLocation";

export async function validate({
  root,
  fix,
  watch,
}: {
  root?: string;
  fix?: boolean;
  watch?: boolean;
}) {
  const projectRoot = root ? path.resolve(root) : process.cwd();

  let prettier: typeof import("prettier") | undefined;
  try {
    prettier = await import("prettier");
  } catch {
    console.log("Prettier not found, skipping formatting");
  }

  // Runs a single validation pass over the project and returns the number of
  // errors found. Re-reads config and val files each call so it always reflects
  // the latest state on disk (used both for one-shot and watch mode).
  async function runOnce(): Promise<number> {
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

    const fixedFiles = new Set<string>();
    let totalErrors = 0;

    // Caches each val file's parsed source so files are read/parsed at most once
    // per pass when resolving sourcePaths to file locations and code frames.
    const sourceFileCache: SourceFileCache = new Map();

    // Resolves a sourcePath to `file:line:col (key|value)`, pointing the carets
    // at the key when the error is about a key and the value otherwise. Falls
    // back to the raw sourcePath (no label) when it cannot be resolved.
    const formatLocation = (sourcePath: string, keyError?: boolean) => {
      const target = keyError ? "key" : "value";
      const location = sourcePathToFileLocation(
        sourcePath,
        projectRoot,
        sourceFileCache,
        target,
      );
      if (location === sourcePath) {
        return location;
      }
      return `${location} (${target})`;
    };

    // Prints a Rust-style code frame (when the location can be resolved) for an
    // error at the given sourcePath, underlining the key or the value.
    const logSourceLocation = (sourcePath: string, keyError?: boolean) => {
      const frame = sourcePathToCodeFrame(
        sourcePath,
        projectRoot,
        sourceFileCache,
        keyError ? "key" : "value",
      );
      if (frame !== undefined) {
        console.log("\n" + frame);
      }
    };

    for await (const event of runValidation({
      root: projectRoot,
      fix: !!fix,
      valFiles,
      project: resolvedValConfigFile?.project,
      remote: {
        remoteHost: process.env.VAL_REMOTE_HOST || DEFAULT_VAL_REMOTE_HOST,
        getSettings: (projectName, options) =>
          getSettings(projectName, options),
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
            `${formatLocation(event.sourcePath, event.keyError)}:`,
            event.message,
          );
          logSourceLocation(event.sourcePath, event.keyError);
          break;
        case "validation-fixable-error":
          console.log(
            event.fixable ? picocolors.yellow("⚠") : picocolors.red("✘"),
            `Got ${event.fixable ? "fixable " : ""}error in`,
            `${formatLocation(event.sourcePath, event.keyError)}:`,
            event.message,
          );
          logSourceLocation(event.sourcePath, event.keyError);
          break;
        case "unknown-fix":
          console.log(
            picocolors.red("✘"),
            "Unknown fix",
            event.fixes,
            "for",
            formatLocation(event.sourcePath, event.keyError),
          );
          logSourceLocation(event.sourcePath, event.keyError);
          break;
        case "unregistered-module":
          console.log(
            picocolors.yellow("⚠"),
            `/${event.file} is not registered in val.modules - skipping`,
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
    } else {
      console.log(picocolors.green("✔"), "No validation errors found");
    }
    return totalErrors;
  }

  if (!watch) {
    const totalErrors = await runOnce();
    if (totalErrors > 0) {
      process.exit(1);
    }
    return;
  }

  await watchAndValidate(projectRoot, runOnce);
}

// Directory names anywhere in the path that should never be watched.
const WATCH_IGNORED = /(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/;

function isRelevantValFile(filePath: string): boolean {
  const base = path.basename(filePath);
  return (
    base === "val.modules.ts" ||
    base === "val.modules.js" ||
    base === "val.config.ts" ||
    base === "val.config.js" ||
    /\.val\.(ts|js)$/.test(base)
  );
}

async function watchAndValidate(
  projectRoot: string,
  runOnce: () => Promise<number>,
) {
  // Initial pass.
  await runOnce();
  const watchingMessage = picocolors.dim(
    "Watching for changes... (Ctrl+C to exit)",
  );
  console.log(watchingMessage);

  // chokidar 5 is ESM-only; load it dynamically (like prettier above).
  const { watch } = await import("chokidar");

  let running = false;
  let pending = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const triggerRun = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    // Clear the screen (and scrollback) so only the latest result shows.
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    console.log(picocolors.cyanBright("Re-validating..."));
    try {
      await runOnce();
    } catch (err) {
      console.error(err);
    }
    console.log(watchingMessage);
    running = false;
    if (pending) {
      pending = false;
      void triggerRun();
    }
  };

  const watcher = watch(projectRoot, {
    ignoreInitial: true,
    ignored: (watchedPath: string) => WATCH_IGNORED.test(watchedPath),
  });

  watcher.on("all", (_event, changedPath) => {
    if (!isRelevantValFile(changedPath)) {
      return;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => void triggerRun(), 150);
  });

  process.on("SIGINT", () => {
    void watcher.close().then(() => process.exit(0));
  });
}
