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
  sourcePathToLocationParts,
  type SourceFileCache,
} from "./utils/sourcePathToFileLocation";

type Diagnostic = {
  // "fixable" => ⚠ (run --fix), "error" => ✘
  severity: "fixable" | "error";
  sourcePath: string;
  message: string;
  keyError?: boolean;
};

type ModuleReport = {
  // Relative file path (no leading slash).
  file: string;
  durationMs: number;
  diagnostics: Diagnostic[];
};

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

    // Diagnostics are buffered per module (keyed by relative file path) so we can
    // render them grouped and prioritised after the run, rather than streaming
    // them out interleaved. Transient progress (remote/fix-applied) still streams
    // live below.
    const reports = new Map<string, ModuleReport>();
    const valid: { file: string; durationMs: number }[] = [];
    const skipped: string[] = [];

    // Relative file path (no leading slash), matching the code frame's
    // relativeFile so headers, diagnostics and frames all agree.
    const relFile = (file: string) => file.replace(/^\//, "");
    // The module a sourcePath/file belongs to is the part before the `?p=...`.
    const moduleOf = (sourcePathOrFile: string) =>
      relFile(sourcePathOrFile.split("?")[0]);

    const reportFor = (file: string): ModuleReport => {
      const key = relFile(file);
      let report = reports.get(key);
      if (!report) {
        report = { file: key, durationMs: 0, diagnostics: [] };
        reports.set(key, report);
      }
      return report;
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
          valid.push({
            file: relFile(event.file),
            durationMs: event.durationMs,
          });
          break;
        case "file-error-count":
          reportFor(event.file).durationMs = event.durationMs;
          totalErrors += event.errorCount;
          break;
        case "validation-error":
          reportFor(moduleOf(event.sourcePath)).diagnostics.push({
            severity: "error",
            sourcePath: event.sourcePath,
            message: event.message,
            ...(event.keyError ? { keyError: true } : {}),
          });
          break;
        case "validation-fixable-error":
          reportFor(moduleOf(event.sourcePath)).diagnostics.push({
            severity: event.fixable ? "fixable" : "error",
            sourcePath: event.sourcePath,
            message: event.message,
            ...(event.keyError ? { keyError: true } : {}),
          });
          break;
        case "unknown-fix":
          reportFor(moduleOf(event.sourcePath)).diagnostics.push({
            severity: "error",
            sourcePath: event.sourcePath,
            message: `Unknown fix: ${event.fixes.join(", ")}`,
            ...(event.keyError ? { keyError: true } : {}),
          });
          break;
        case "unregistered-module":
          skipped.push(event.file);
          break;
        case "fatal-error":
          // No sourcePath for fatal errors; group by file, render message only.
          reportFor(event.file).diagnostics.push({
            severity: "error",
            sourcePath: event.file,
            message: event.message,
          });
          break;
        case "fix-applied":
          console.log(
            picocolors.yellow("⚠"),
            "Applied fix for",
            event.sourcePath,
          );
          fixedFiles.add(event.file);
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

    // Renders a module's diagnostics under a single left "│" gutter bar, with the
    // file name on top and blank gutter lines for air. Output flows least- to
    // most-actionable top-to-bottom, so fixable diagnostics are shown last (at the
    // bottom, nearest the prompt).
    const renderModule = (report: ModuleReport) => {
      const bar = picocolors.dim("│");
      const diagnostics = [...report.diagnostics].sort((a, b) =>
        a.severity === b.severity ? 0 : a.severity === "fixable" ? 1 : -1,
      );
      const fixableCount = diagnostics.filter(
        (d) => d.severity === "fixable",
      ).length;
      const total = diagnostics.length;
      const hasError = fixableCount < total;
      const symbol = hasError ? picocolors.red("✘") : picocolors.yellow("⚠");
      let label: string;
      if (fixableCount === total) {
        label = `${fixableCount} fixable`;
      } else if (fixableCount > 0) {
        label = `${total} error${total > 1 ? "s" : ""} (${fixableCount} fixable)`;
      } else {
        label = `${total} error${total > 1 ? "s" : ""}`;
      }
      console.log(
        `${picocolors.bold(report.file)}  ${symbol} ${label}  ${picocolors.dim(
          `(${report.durationMs}ms)`,
        )}`,
      );
      for (const d of diagnostics) {
        const target = d.keyError ? "key" : "value";
        const dsym =
          d.severity === "fixable"
            ? picocolors.yellow("⚠")
            : picocolors.red("✘");
        const suffix =
          d.severity === "fixable"
            ? picocolors.dim("  ·  fixable, run --fix")
            : "";
        const parts = sourcePathToLocationParts(
          d.sourcePath,
          projectRoot,
          sourceFileCache,
          target,
        );
        console.log(bar);
        if (parts) {
          console.log(
            `${bar}  ${dsym}  ${parts.line}:${parts.character} (${target})${suffix}`,
          );
          console.log(`${bar}     ${d.message}`);
        } else {
          console.log(`${bar}  ${dsym}  ${d.message}${suffix}`);
        }
        const frame = sourcePathToCodeFrame(
          d.sourcePath,
          projectRoot,
          sourceFileCache,
          target,
        );
        if (frame !== undefined) {
          console.log(bar);
          for (const frameLine of frame.split("\n")) {
            console.log(`${bar}     ${frameLine}`);
          }
        }
      }
      console.log(bar);
      console.log("");
    };

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

    // Render the grouped report least- to most-actionable, top-to-bottom, so the
    // most important things end up at the bottom nearest the prompt: valid files
    // and skipped modules first, then error-only modules, then fixable modules.
    const allReports = [...reports.values()];
    const fixableModules = allReports.filter((r) =>
      r.diagnostics.some((d) => d.severity === "fixable"),
    );
    const errorModules = allReports.filter(
      (r) => !r.diagnostics.some((d) => d.severity === "fixable"),
    );

    for (const v of valid) {
      console.log(
        picocolors.green("✔"),
        picocolors.dim(`${v.file}  valid (${v.durationMs}ms)`),
      );
    }
    for (const file of skipped) {
      console.log(
        picocolors.yellow("⚠"),
        picocolors.dim(`/${file} is not registered in val.modules - skipping`),
      );
    }

    if (allReports.length > 0) {
      console.log("");
    }
    for (const report of [...errorModules, ...fixableModules]) {
      renderModule(report);
    }

    const fixableTotal = allReports.reduce(
      (n, r) =>
        n + r.diagnostics.filter((d) => d.severity === "fixable").length,
      0,
    );
    if (totalErrors > 0) {
      let summary = `${totalErrors} error${totalErrors > 1 ? "s" : ""}`;
      if (fixableTotal > 0) {
        summary += ` (${fixableTotal} fixable)`;
      }
      summary += ` across ${allReports.length} file${
        allReports.length > 1 ? "s" : ""
      }`;
      if (valid.length > 0) {
        summary += ` · ${valid.length} valid`;
      }
      if (skipped.length > 0) {
        summary += ` · ${skipped.length} skipped`;
      }
      console.log(picocolors.red("✘"), summary);
    } else {
      let summary = "No validation errors found";
      if (valid.length > 0) {
        summary += ` · ${valid.length} valid`;
      }
      if (skipped.length > 0) {
        summary += ` · ${skipped.length} skipped`;
      }
      console.log(picocolors.green("✔"), summary);
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
